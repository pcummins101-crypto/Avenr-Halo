<?php

defined( 'ABSPATH' ) || exit;

/**
 * Guardian recovery for an already-active live-sharing session.
 *
 * Guardian is deliberately capability-separated from both the public viewer
 * token and the location writer token. A viewer must possess the additional
 * per-session Guardian token to ask the rider to restore updates; that request
 * never creates a sharing row, extends its expiry, or returns a writer secret.
 */
final class Avenra_Halo_V2_Guardian {
	private const NS = 'avenra-halo/v2';
	private const FIRETEXT_ENDPOINT = 'https://www.firetext.co.uk/api/sendsms';
	private const FALLBACK_HOOK = 'avenra_halo_v2_guardian_sms_fallback';

	private static ?self $instance = null;
	private Avenra_Halo_V2_Database $db;
	private Avenra_Halo_V2_Auth $auth;
	private bool $booted = false;

	private function __construct() {
		$this->db   = Avenra_Halo_V2_Database::instance();
		$this->auth = Avenra_Halo_V2_Auth::instance();
	}

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	public function boot(): void {
		if ( $this->booted ) {
			return;
		}
		$this->booted = true;

		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( self::FALLBACK_HOOK, array( $this, 'send_delayed_rider_notification' ), 10, 2 );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NS,
			'/live-tracking/(?P<viewer>[A-Za-z0-9_-]{40,90})/recovery-request',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'request_recovery' ),
				'permission_callback' => array( $this, 'permission_public_recovery' ),
			)
		);

		register_rest_route(
			self::NS,
			'/live-tracking/session/(?P<session_id>[a-fA-F0-9-]{36})/recovery-status',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'recovery_status' ),
				'permission_callback' => array( $this, 'permission_session_access' ),
			)
		);

		register_rest_route(
			self::NS,
			'/live-tracking/session/(?P<session_id>[a-fA-F0-9-]{36})/recovery-ack',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'acknowledge_recovery' ),
				'permission_callback' => array( $this, 'permission_session_access' ),
			)
		);

		register_rest_route(
			self::NS,
			'/live-tracking/session/(?P<session_id>[a-fA-F0-9-]{36})/resume',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'resume_recovery' ),
				'permission_callback' => array( $this->auth, 'permission_authenticated' ),
			)
		);

		register_rest_route(
			self::NS,
			'/live-tracking/session/(?P<session_id>[a-fA-F0-9-]{36})/position',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'update_session_position' ),
				'permission_callback' => array( $this, 'permission_session_access' ),
			)
		);

		register_rest_route(
			self::NS,
			'/live-tracking/session/(?P<session_id>[a-fA-F0-9-]{36})',
			array(
				'methods'             => 'DELETE',
				'callback'            => array( $this, 'end_session' ),
				'permission_callback' => array( $this, 'permission_session_access' ),
			)
		);
	}

	/** Public mutations must be JSON and demonstrably originate at the app origin. */
	public function permission_public_recovery( WP_REST_Request $request ): bool|WP_Error {
		$permission = $this->auth->permission_public_auth( $request );
		if ( true !== $permission ) {
			return $permission;
		}

		$source     = trim( (string) ( $request->get_header( 'Origin' ) ?: $request->get_header( 'Referer' ) ) );
		$fetch_site = strtolower( trim( (string) $request->get_header( 'Sec-Fetch-Site' ) ) );
		if ( '' === $source && 'same-origin' !== $fetch_site ) {
			try {
				$allow_without_origin = (bool) apply_filters( 'avenra_halo_v2_guardian_allow_request_without_origin', false, $request );
			} catch ( Throwable $error ) {
				$allow_without_origin = false;
			}
			if ( ! $allow_without_origin ) {
				return Avenra_Halo_V2_Response::permission_error(
					'guardian_origin_required',
					__( 'Halo blocked a recovery request from outside the secure app.', 'avenra-halo-v2' ),
					403
				);
			}
		}

		return true;
	}

	/**
	 * Session status, acknowledgement and writer operations accept either the
	 * signed-in owner or the existing writer capability. The handler performs the
	 * row-level ownership/hash check after this origin boundary.
	 */
	public function permission_session_access( WP_REST_Request $request ): bool|WP_Error {
		if ( $this->auth->is_authenticated() ) {
			return $this->auth->permission_authenticated( $request );
		}

		$origin = $this->auth->permission_same_origin( $request );
		if ( true !== $origin || 'OPTIONS' === strtoupper( $request->get_method() ) ) {
			return $origin;
		}

		if ( ! in_array( strtoupper( $request->get_method() ), array( 'GET', 'HEAD' ), true ) ) {
			$content_type = strtolower( trim( (string) $request->get_header( 'Content-Type' ) ) );
			if ( ! str_starts_with( $content_type, 'application/json' ) ) {
				return Avenra_Halo_V2_Response::permission_error(
					'guardian_json_required',
					__( 'Halo recovery updates must come from the secure app.', 'avenra-halo-v2' ),
					403
				);
			}
		}

		return true;
	}

	public function request_recovery( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body           = $this->body( $request );
		$viewer         = trim( (string) $request['viewer'] );
		$guardian       = trim( (string) ( $request->get_header( 'X-Halo-Guardian' ) ?: ( $body['guardian_token'] ?? $body['guardian'] ?? '' ) ) );
		$viewer_hash    = hash( 'sha256', $viewer );
		$guardian_hash  = hash( 'sha256', $guardian );
		$requested_id   = sanitize_text_field( trim( (string) ( $body['request_id'] ?? '' ) ) );
		$request_id     = preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $requested_id ) ? $requested_id : wp_generate_uuid4();
		$ip             = $this->request_ip();

		$ip_allowed = $this->rate_limit( 'guardian-recovery-ip', $ip, 20, HOUR_IN_SECONDS );
		if ( strlen( $guardian ) < 40 || ! $ip_allowed ) {
			if ( strlen( $guardian ) < 40 ) {
				return Avenra_Halo_V2_Response::error( 'guardian_not_found', __( 'This Guardian recovery link is unavailable.', 'avenra-halo-v2' ), 404 );
			}
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_throttled', __( 'Please wait before making another recovery request.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}

		$table = $this->db->table( 'live_tracking' );
		$row   = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $table ) . '` WHERE viewer_token_hash = %s AND guardian_token_hash = %s AND guardian_enabled = 1 LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$viewer_hash,
				$guardian_hash
			)
		);
		if ( ! $this->is_active( $row ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_not_found', __( 'This Guardian recovery link is unavailable.', 'avenra-halo-v2' ), 404 );
		}

		// Replaying the caller's stable request id is deliberately idempotent and
		// never schedules a second SMS or consumes the per-capability request budget.
		if ( '' !== (string) ( $row->recovery_request_id ?? '' ) && hash_equals( (string) $row->recovery_request_id, $request_id ) ) {
			return Avenra_Halo_V2_Response::success( $this->public_request_data( $row ), 202 );
		}
		if ( ! $this->feed_is_stale( $row ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_feed_current', __( 'Live ride updates are already current.', 'avenra-halo-v2' ), 409, array( 'retry_after' => $this->stale_after_seconds() ) );
		}

		if ( ! $this->rate_limit( 'guardian-recovery-capability', $guardian_hash, 6, HOUR_IN_SECONDS ) || ! $this->rate_limit( 'guardian-recovery-session', (string) $row->public_id, 6, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_throttled', __( 'Please wait before making another recovery request.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}

		$lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) (int) $row->customer_id, 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_busy', __( 'Halo is already processing a recovery request. Please retry.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		try {
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM `' . esc_sql( $table ) . '` WHERE viewer_token_hash = %s AND guardian_token_hash = %s AND guardian_enabled = 1 LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$viewer_hash,
					$guardian_hash
				)
			);
			if ( ! $this->is_active( $row ) ) {
				return Avenra_Halo_V2_Response::error( 'guardian_not_found', __( 'This Guardian recovery link is unavailable.', 'avenra-halo-v2' ), 404 );
			}
			if ( '' !== (string) ( $row->recovery_request_id ?? '' ) && hash_equals( (string) $row->recovery_request_id, $request_id ) ) {
				return Avenra_Halo_V2_Response::success( $this->public_request_data( $row ), 202 );
			}
			if ( ! $this->feed_is_stale( $row ) ) {
				return Avenra_Halo_V2_Response::error( 'guardian_feed_current', __( 'Live ride updates are already current.', 'avenra-halo-v2' ), 409, array( 'retry_after' => $this->stale_after_seconds() ) );
			}

			$cooldown = $this->cooldown_seconds();
			$last_request = $this->timestamp( $row->recovery_requested_at ?? null );
			if ( $last_request > time() - $cooldown ) {
				$retry_after = max( 1, $cooldown - ( time() - $last_request ) );
				return Avenra_Halo_V2_Response::error( 'guardian_recovery_cooldown', __( 'A Guardian request was already sent recently.', 'avenra-halo-v2' ), 429, array( 'retry_after' => $retry_after ) );
			}

			$now = current_time( 'mysql', true );
			$stale_before = gmdate( 'Y-m-d H:i:s', time() - $this->stale_after_seconds() );
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $table ) . '` SET recovery_request_id = %s, recovery_request_count = recovery_request_count + 1, recovery_requested_at = %s, recovery_acknowledged_at = NULL, recovery_resumed_at = NULL, recovery_notification_attempted_at = NULL, recovery_notified_at = NULL WHERE id = %d AND ended_at IS NULL AND expires_at > %s AND ((last_ping_at IS NOT NULL AND last_ping_at <= %s) OR (last_ping_at IS NULL AND started_at <= %s))', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$request_id,
					$now,
					(int) $row->id,
					$now,
					$stale_before,
					$stale_before
				)
			);
			if ( 0 === $updated ) {
				$fresh = $this->session_by_public_id( (string) $row->public_id );
				if ( $this->is_active( $fresh ) && ! $this->feed_is_stale( $fresh ) ) {
					return Avenra_Halo_V2_Response::error( 'guardian_feed_current', __( 'Live ride updates are already current.', 'avenra-halo-v2' ), 409, array( 'retry_after' => $this->stale_after_seconds() ) );
				}
			}
			if ( 1 !== $updated ) {
				return Avenra_Halo_V2_Response::error( 'guardian_recovery_failed', __( 'Halo could not record this recovery request.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}

			$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $table ) . '` WHERE id = %d LIMIT 1', (int) $row->id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( ! is_object( $row ) ) {
				return Avenra_Halo_V2_Response::error( 'guardian_recovery_failed', __( 'Halo recorded the request but could not safely verify it.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
		} finally {
			$this->db->release_advisory_lock( $lock );
		}

		if ( is_object( $row ) && ! $this->schedule_fallback( (string) $row->public_id, $request_id ) ) {
			do_action( 'avenra_halo_v2_guardian_schedule_failed', (string) $row->public_id, $request_id, Avenra_Halo_V2_Response::request_id() );
		}

		return Avenra_Halo_V2_Response::success( $this->public_request_data( $row ), 202 );
	}

	public function recovery_status( WP_REST_Request $request ): WP_REST_Response {
		$row = $this->authorised_session( $request, false );
		if ( is_wp_error( $row ) ) {
			return $this->session_error( $row );
		}

		return Avenra_Halo_V2_Response::success( $this->serialise_recovery( $row ) );
	}

	public function acknowledge_recovery( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$row = $this->authorised_session( $request, false );
		if ( is_wp_error( $row ) ) {
			return $this->session_error( $row );
		}
		if ( empty( $row->recovery_request_id ) || empty( $row->recovery_requested_at ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_not_requested', __( 'There is no Guardian recovery request to acknowledge.', 'avenra-halo-v2' ), 409 );
		}

		$body       = $this->body( $request );
		$request_id = sanitize_text_field( trim( (string) ( $body['request_id'] ?? '' ) ) );
		if ( '' !== $request_id && ! hash_equals( (string) $row->recovery_request_id, $request_id ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_changed', __( 'A newer Guardian request is now active.', 'avenra-halo-v2' ), 409 );
		}
		if ( ! $this->rate_limit( 'guardian-recovery-ack', (string) $row->public_id, 30, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_ack_throttled', __( 'Please wait before acknowledging again.', 'avenra-halo-v2' ), 429 );
		}

		$now = current_time( 'mysql', true );
		$notification_lock = $this->db->acquire_advisory_lock( 'guardian-notification', (string) $row->public_id, 2 );
		if ( ! $notification_lock ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_busy', __( 'Halo is already processing this recovery request.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET recovery_acknowledged_at = COALESCE(recovery_acknowledged_at, %s) WHERE id = %d AND recovery_request_id = %s AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$now,
					(int) $row->id,
					(string) $row->recovery_request_id,
					$now
				)
			);
		} finally {
			$this->db->release_advisory_lock( $notification_lock );
		}
		if ( false === $updated ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_ack_failed', __( 'Halo could not acknowledge this recovery request.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}

		$row = $this->session_by_public_id( (string) $row->public_id );
		return Avenra_Halo_V2_Response::success( $this->serialise_recovery( $row ) );
	}

	public function resume_recovery( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$public_id = strtolower( trim( (string) $request['session_id'] ) );
		$row       = $this->session_by_public_id( $public_id );
		if ( ! $this->is_active( $row ) || (int) $row->customer_id !== $this->auth->customer_id() || empty( $row->guardian_enabled ) ) {
			return Avenra_Halo_V2_Response::error( 'tracking_not_found', __( 'This live-sharing session is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		if ( empty( $row->recovery_request_id ) || empty( $row->recovery_requested_at ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_not_requested', __( 'There is no Guardian recovery request to resume.', 'avenra-halo-v2' ), 409 );
		}
		$body       = $this->body( $request );
		$request_id = sanitize_text_field( trim( (string) ( $body['request_id'] ?? '' ) ) );
		if ( '' !== $request_id && ! hash_equals( (string) $row->recovery_request_id, $request_id ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_changed', __( 'A newer Guardian request is now active.', 'avenra-halo-v2' ), 409 );
		}
		if ( ! $this->rate_limit( 'guardian-resume-account', (string) $this->auth->customer_id(), 8, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'guardian_resume_throttled', __( 'Please wait before restoring another publisher key.', 'avenra-halo-v2' ), 429 );
		}

		$lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) $this->auth->customer_id(), 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'guardian_recovery_busy', __( 'Halo is already changing this live-sharing session.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		try {
			$row = $this->session_by_public_id( $public_id );
			if ( ! $this->is_active( $row ) || (int) $row->customer_id !== $this->auth->customer_id() || empty( $row->guardian_enabled ) || ! $this->auth->current_session_is_active() ) {
				return Avenra_Halo_V2_Response::error( 'tracking_not_found', __( 'This live-sharing session is unavailable.', 'avenra-halo-v2' ), 404 );
			}
			if ( empty( $row->recovery_request_id ) || ( '' !== $request_id && ! hash_equals( (string) $row->recovery_request_id, $request_id ) ) ) {
				return Avenra_Halo_V2_Response::error( 'guardian_recovery_changed', __( 'A newer Guardian request is now active.', 'avenra-halo-v2' ), 409 );
			}

			$writer = Avenra_Halo_V2_Auth::random_token( 32 );
			$now    = current_time( 'mysql', true );
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET writer_token_hash = %s, recovery_acknowledged_at = COALESCE(recovery_acknowledged_at, %s) WHERE id = %d AND recovery_request_id = %s AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					hash( 'sha256', $writer ),
					$now,
					(int) $row->id,
					(string) $row->recovery_request_id,
					$now
				)
			);
			if ( 1 !== $updated ) {
				return Avenra_Halo_V2_Response::error( 'guardian_resume_failed', __( 'Halo could not restore the live publisher key.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$row = $this->session_by_public_id( $public_id );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}

		return Avenra_Halo_V2_Response::success(
			array_merge(
				$this->serialise_recovery( $row ),
				array(
					'writer_token'  => $writer,
					'last_sequence' => (int) $row->last_sequence,
					'session_id'    => (string) $row->public_id,
				)
			)
		);
	}

	public function update_session_position( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body       = $this->body( $request );
		$writer     = $this->writer_token( $request, $body );
		$public_id  = strtolower( trim( (string) $request['session_id'] ) );
		$row        = $this->session_by_public_id( $public_id );
		$writer_hash = hash( 'sha256', $writer );
		if ( ! $this->is_active( $row ) || strlen( $writer ) < 40 || ! hash_equals( (string) $row->writer_token_hash, $writer_hash ) ) {
			return Avenra_Halo_V2_Response::error( 'tracking_not_found', __( 'This live-sharing session is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		if ( ! $this->rate_limit( 'guardian-position-session', $public_id, 900, HOUR_IN_SECONDS ) || ! $this->rate_limit( 'guardian-position-ip', $this->request_ip(), 1800, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'tracking_update_throttled', __( 'Too many location updates were received.', 'avenra-halo-v2' ), 429 );
		}

		$sequence = max( 1, absint( $body['sequence'] ?? 1 ) );
		$lat      = $this->coordinate( $body['lat'] ?? $body['latitude'] ?? null, -90, 90 );
		$lng      = $this->coordinate( $body['lng'] ?? $body['longitude'] ?? null, -180, 180 );
		if ( null === $lat || null === $lng ) {
			return Avenra_Halo_V2_Response::error( 'invalid_tracking_update', __( 'The live location update was incomplete.', 'avenra-halo-v2' ), 422 );
		}

		$speed     = $this->number( $body['speed_mph'] ?? $body['speed'] ?? 0, 0, 250, 0 );
		$top_speed = max( $speed, $this->number( $body['top_speed_mph'] ?? $body['top_speed'] ?? 0, 0, 250, 0 ) );
		$road_name = $this->text( sanitize_text_field( (string) ( $body['road_name'] ?? '' ) ), 190 );
		$heading   = $this->nullable_number( $body['heading'] ?? null, 0, 360 );
		$accuracy  = $this->nullable_number( $body['accuracy_m'] ?? null, 0, 10000 );
		$now       = current_time( 'mysql', true );
		$sql       = $wpdb->prepare(
			"UPDATE `" . esc_sql( $this->db->table( 'live_tracking' ) ) . "` SET last_sequence = %d, latitude = %f, longitude = %f, speed_mph = %f, top_speed_mph = GREATEST(top_speed_mph, %f), road_name = NULLIF(%s, ''), heading = NULLIF(%s, ''), accuracy_m = NULLIF(%s, ''), last_ping_at = %s, recovery_acknowledged_at = IF(recovery_requested_at IS NOT NULL AND (recovery_resumed_at IS NULL OR recovery_resumed_at < recovery_requested_at), COALESCE(recovery_acknowledged_at, %s), recovery_acknowledged_at), recovery_resumed_at = IF(recovery_requested_at IS NOT NULL AND (recovery_resumed_at IS NULL OR recovery_resumed_at < recovery_requested_at), %s, recovery_resumed_at) WHERE public_id = %s AND writer_token_hash = %s AND ended_at IS NULL AND expires_at > %s AND last_sequence < %d", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$sequence,
			$lat,
			$lng,
			$speed,
			$top_speed,
			$road_name,
			$heading,
			$accuracy,
			$now,
			$now,
			$now,
			$public_id,
			$writer_hash,
			$now,
			$sequence
		);
		$notification_lock = null;
		$requested_at = $this->timestamp( $row->recovery_requested_at ?? null );
		if ( ! empty( $row->guardian_enabled ) && $requested_at > 0 && $this->timestamp( $row->recovery_resumed_at ?? null ) < $requested_at ) {
			$notification_lock = $this->db->acquire_advisory_lock( 'guardian-notification', $public_id, 2 );
			if ( ! $notification_lock ) {
				return Avenra_Halo_V2_Response::error( 'tracking_update_busy', __( 'Halo is finalising a Guardian update. Please retry.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
			}
		}
		try {
			$updated = $wpdb->query( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		} finally {
			if ( $notification_lock ) {
				$this->db->release_advisory_lock( $notification_lock );
			}
		}
		if ( false === $updated ) {
			return Avenra_Halo_V2_Response::error( 'tracking_update_failed', __( 'The live location could not be updated right now.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( 0 === $updated ) {
			$row = $this->session_by_public_id( $public_id );
			if ( ! $this->is_active( $row ) || ! hash_equals( (string) ( $row->writer_token_hash ?? '' ), $writer_hash ) ) {
				return Avenra_Halo_V2_Response::error( 'tracking_ended', __( 'This live-sharing session has ended.', 'avenra-halo-v2' ), 410 );
			}
			return Avenra_Halo_V2_Response::error( 'tracking_update_rejected', __( 'A newer location update was already accepted.', 'avenra-halo-v2' ), 409, array( 'last_sequence' => (int) $row->last_sequence ) );
		}

		$row = $this->session_by_public_id( $public_id );
		return Avenra_Halo_V2_Response::success( array_merge( array( 'accepted' => true, 'sequence' => $sequence ), $this->serialise_recovery( $row ) ) );
	}

	public function end_session( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$row = $this->authorised_session( $request, false );
		if ( is_wp_error( $row ) ) {
			return $this->session_error( $row );
		}
		$lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) (int) $row->customer_id, 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'live_tracking_busy', __( 'Halo is already changing this live-sharing session.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		try {
			$fresh = $this->authorised_session( $request, false );
			if ( is_wp_error( $fresh ) ) {
				return $this->session_error( $fresh );
			}
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE id = %d AND ended_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					(int) $fresh->id
				)
			);
			if ( false === $updated ) {
				return Avenra_Halo_V2_Response::error( 'tracking_revoke_failed', __( 'Halo could not end this live-sharing session.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
		} finally {
			$this->db->release_advisory_lock( $lock );
		}

		return Avenra_Halo_V2_Response::success( array( 'ended' => true, 'session_id' => (string) $row->public_id ) );
	}

	/** A scheduled fallback is a no-op once a position newer than the request exists. */
	public function send_delayed_rider_notification( string $public_id, string $request_id ): void {
		global $wpdb;

		$public_id = strtolower( trim( $public_id ) );
		$notification_lock = $this->db->acquire_advisory_lock( 'guardian-notification', $public_id, 1 );
		if ( ! $notification_lock ) {
			do_action( 'avenra_halo_v2_guardian_notification_failed', $public_id, $request_id, 'notification_busy', Avenra_Halo_V2_Response::request_id() );
			return;
		}
		try {
		$row = $this->session_by_public_id( $public_id );
		if ( ! $this->is_active( $row ) || empty( $row->guardian_enabled ) || empty( $row->recovery_requested_at ) || ! hash_equals( (string) $row->recovery_request_id, $request_id ) ) {
			return;
		}
		$requested_at = $this->timestamp( $row->recovery_requested_at );
		if ( $this->timestamp( $row->recovery_acknowledged_at ?? null ) >= $requested_at || $this->timestamp( $row->recovery_resumed_at ?? null ) >= $requested_at || $this->timestamp( $row->last_ping_at ?? null ) > $requested_at || $this->timestamp( $row->recovery_notification_attempted_at ?? null ) >= $requested_at ) {
			return;
		}

		$attempted_at = current_time( 'mysql', true );
		$claimed = $wpdb->query(
			$wpdb->prepare(
				'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET recovery_notification_attempted_at = %s WHERE id = %d AND recovery_request_id = %s AND (recovery_notification_attempted_at IS NULL OR recovery_notification_attempted_at < recovery_requested_at) AND (recovery_acknowledged_at IS NULL OR recovery_acknowledged_at < recovery_requested_at) AND (recovery_resumed_at IS NULL OR recovery_resumed_at < recovery_requested_at) AND (last_ping_at IS NULL OR last_ping_at <= recovery_requested_at)', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$attempted_at,
				(int) $row->id,
				$request_id
			)
		);
		if ( 1 !== $claimed ) {
			return;
		}

		$customer     = $this->db->customer_by_id( (int) $row->customer_id );
		$mobile_value = '';
		if ( is_object( $customer ) ) {
			foreach ( array( 'mobile_number', 'mobile', 'phone_number', 'telephone' ) as $mobile_field ) {
				if ( isset( $customer->{$mobile_field} ) && '' !== trim( (string) $customer->{$mobile_field} ) ) {
					$mobile_value = (string) $customer->{$mobile_field};
					break;
				}
			}
		}
		$mobile = $this->normalise_mobile( $mobile_value );
		if ( '' === $mobile ) {
			$this->notification_failed( $row, $request_id, 'rider_mobile_unavailable' );
			return;
		}

		$label = trim( sanitize_text_field( (string) $row->guardian_label ) );
		$who   = '' !== $label ? $label : __( 'A trusted viewer', 'avenra-halo-v2' );
		$resume_url = add_query_arg( 'guardian_resume', (string) $row->public_id, Avenra_Halo_V2_Plugin::page_url() );
		$message = sprintf(
			/* translators: 1: trusted viewer label, 2: Halo application URL */
			__( '%1$s asked Halo to restore your live ride updates. When safely stopped, open Halo to resume sharing: %2$s', 'avenra-halo-v2' ),
			$who,
			$resume_url
		);
		try {
			$message = (string) apply_filters( 'avenra_halo_v2_guardian_sms_message', $message, $row, $customer );
		} catch ( Throwable $error ) {
			$this->notification_failed( $row, $request_id, 'message_filter_failed' );
			return;
		}
		$message = $this->text( wp_strip_all_tags( $message ), 480 );
		if ( '' === $message ) {
			$this->notification_failed( $row, $request_id, 'message_unavailable' );
			return;
		}

		$result = $this->deliver_sms(
			array(
				'destination' => $mobile,
				'message'     => $message,
				'public_id'   => (string) $row->public_id,
				'request_id'  => $request_id,
				'customer_id' => (int) $row->customer_id,
			)
		);
		if ( empty( $result['accepted'] ) ) {
			$this->notification_failed( $row, $request_id, (string) ( $result['safe_code'] ?? 'delivery_failed' ) );
			return;
		}

		$notified_at = current_time( 'mysql', true );
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET recovery_notified_at = %s WHERE id = %d AND recovery_request_id = %s AND recovery_notification_attempted_at = %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$notified_at,
				(int) $row->id,
				$request_id,
				$attempted_at
			)
		);
		do_action( 'avenra_halo_v2_guardian_rider_notified', (string) $row->public_id, $request_id, sanitize_key( (string) ( $result['provider'] ?? '' ) ) );
		} finally {
			$this->db->release_advisory_lock( $notification_lock );
		}
	}

	/** @return array{accepted:bool,provider:string,safe_code:string} */
	private function deliver_sms( array $context ): array {
		try {
			$override = apply_filters( 'avenra_halo_v2_guardian_sms_delivery', null, $context );
		} catch ( Throwable $error ) {
			return array( 'accepted' => false, 'provider' => 'filtered', 'safe_code' => 'adapter_exception' );
		}
		if ( null !== $override ) {
			if ( true === $override ) {
				return array( 'accepted' => true, 'provider' => 'filtered', 'safe_code' => 'accepted' );
			}
			if ( is_array( $override ) ) {
				$accepted = true === ( $override['accepted'] ?? null ) || true === ( $override['sent'] ?? null ) || true === ( $override['success'] ?? null );
				return array(
					'accepted' => $accepted,
					'provider' => sanitize_key( (string) ( $override['provider'] ?? 'filtered' ) ),
					'safe_code'=> sanitize_key( (string) ( $override['safe_code'] ?? ( $accepted ? 'accepted' : 'adapter_rejected' ) ) ),
				);
			}
			return array( 'accepted' => false, 'provider' => 'filtered', 'safe_code' => 'adapter_invalid_result' );
		}

		$api_key = defined( 'AVENRA_FIRETEXT_API_KEY' ) ? trim( (string) AVENRA_FIRETEXT_API_KEY ) : '';
		if ( '' === $api_key ) {
			return array( 'accepted' => false, 'provider' => 'firetext', 'safe_code' => 'provider_not_configured' );
		}
		try {
			$sender_value = (string) apply_filters( 'avenra_halo_v2_guardian_sms_sender', 'Avenra' );
		} catch ( Throwable $error ) {
			$sender_value = 'Avenra';
		}
		$sender = substr( (string) preg_replace( '/[^A-Za-z0-9]/', '', $sender_value ), 0, 11 );
		if ( '' === $sender ) {
			$sender = 'Avenra';
		}

		try {
			$response = wp_remote_post(
				self::FIRETEXT_ENDPOINT,
				array(
					'timeout'     => 7,
					'redirection' => 0,
					'sslverify'   => true,
					'headers'     => array( 'Accept' => 'text/plain' ),
					'body'        => array(
						'apiKey'  => $api_key,
						'message' => (string) $context['message'],
						'from'    => $sender,
						'to'      => (string) $context['destination'],
					),
				)
			);
		} catch ( Throwable $error ) {
			return array( 'accepted' => false, 'provider' => 'firetext', 'safe_code' => 'transport_exception' );
		}
		if ( is_wp_error( $response ) ) {
			return array( 'accepted' => false, 'provider' => 'firetext', 'safe_code' => 'transport_failed' );
		}
		$http = (int) wp_remote_retrieve_response_code( $response );
		$body = trim( (string) wp_remote_retrieve_body( $response ) );
		if ( 200 === $http && preg_match( '/^0\s*:/', $body ) ) {
			return array( 'accepted' => true, 'provider' => 'firetext', 'safe_code' => 'accepted' );
		}
		return array( 'accepted' => false, 'provider' => 'firetext', 'safe_code' => $http >= 500 || 429 === $http ? 'provider_unconfirmed' : 'provider_rejected' );
	}

	private function notification_failed( object $row, string $request_id, string $safe_code ): void {
		do_action(
			'avenra_halo_v2_guardian_notification_failed',
			(string) $row->public_id,
			$request_id,
			sanitize_key( $safe_code ) ?: 'delivery_failed',
			Avenra_Halo_V2_Response::request_id()
		);
	}

	private function schedule_fallback( string $public_id, string $request_id ): bool {
		$timestamp = time() + $this->notification_delay();
		$args      = array( $public_id, $request_id );
		if ( function_exists( 'as_schedule_single_action' ) ) {
			try {
				return (int) as_schedule_single_action( $timestamp, self::FALLBACK_HOOK, $args, 'avenra-halo-v2', true ) > 0;
			} catch ( Throwable $error ) {
				return false;
			}
		}

		$result = wp_schedule_single_event( $timestamp, self::FALLBACK_HOOK, $args, true );
		return ! is_wp_error( $result ) && true === $result;
	}

	private function authorised_session( WP_REST_Request $request, bool $writer_required ): object {
		$row = $this->session_by_public_id( strtolower( trim( (string) $request['session_id'] ) ) );
		if ( ! $this->is_active( $row ) ) {
			return new WP_Error( 'tracking_not_found' );
		}

		if ( $this->auth->is_authenticated() ) {
			if ( (int) $row->customer_id !== $this->auth->customer_id() ) {
				return new WP_Error( 'tracking_not_found' );
			}
			if ( ! $writer_required ) {
				return $row;
			}
		}

		$writer = $this->writer_token( $request, $this->body( $request ) );
		if ( strlen( $writer ) < 40 || ! hash_equals( (string) $row->writer_token_hash, hash( 'sha256', $writer ) ) ) {
			return new WP_Error( 'tracking_not_found' );
		}

		return $row;
	}

	private function session_error( WP_Error $error ): WP_REST_Response {
		return Avenra_Halo_V2_Response::error( 'tracking_not_found', __( 'This live-sharing session is unavailable.', 'avenra-halo-v2' ), 404 );
	}

	private function session_by_public_id( string $public_id ): ?object {
		global $wpdb;

		if ( ! preg_match( '/^[a-f0-9-]{36}$/', $public_id ) ) {
			return null;
		}
		return $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` WHERE public_id = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$public_id
			)
		);
	}

	private function is_active( mixed $row ): bool {
		return is_object( $row ) && empty( $row->ended_at ) && $this->timestamp( $row->expires_at ?? null ) > time();
	}

	/** @return array<string,mixed> */
	public function serialise_recovery( ?object $row ): array {
		if ( ! is_object( $row ) ) {
			return array();
		}
		$requested = $this->timestamp( $row->recovery_requested_at ?? null );
		$acknowledged = $this->timestamp( $row->recovery_acknowledged_at ?? null );
		$resumed = $this->timestamp( $row->recovery_resumed_at ?? null );
		$status = 'idle';
		if ( $requested > 0 ) {
			$status = $resumed >= $requested ? 'resumed' : ( $acknowledged >= $requested ? 'acknowledged' : 'requested' );
		}

		return array(
			'session_id'                         => (string) ( $row->public_id ?? '' ),
			'public_id'                          => (string) ( $row->public_id ?? '' ),
			'guardian_enabled'                    => ! empty( $row->guardian_enabled ),
			'guardian_recovery_enabled'           => ! empty( $row->guardian_enabled ),
			'guardian_label'                      => sanitize_text_field( (string) ( $row->guardian_label ?? '' ) ),
			'status'                              => $status,
			'recovery_status'                     => $status,
			'request_id'                          => '' !== (string) ( $row->recovery_request_id ?? '' ) ? (string) $row->recovery_request_id : null,
			'request_count'                       => (int) ( $row->recovery_request_count ?? 0 ),
			'requested_at'                        => $this->rfc3339( $row->recovery_requested_at ?? null ),
			'acknowledged_at'                     => $this->rfc3339( $row->recovery_acknowledged_at ?? null ),
			'resumed_at'                          => $this->rfc3339( $row->recovery_resumed_at ?? null ),
			'notification_attempted_at'           => $this->rfc3339( $row->recovery_notification_attempted_at ?? null ),
			'notified_at'                         => $this->rfc3339( $row->recovery_notified_at ?? null ),
			'last_ping_at'                        => $this->rfc3339( $row->last_ping_at ?? null ),
			'expires_at'                          => $this->rfc3339( $row->expires_at ?? null ),
		);
	}

	/**
	 * The public tracker needs only enough state to avoid presenting a duplicate
	 * request and to confirm that a newer point arrived. Do not disclose app
	 * acknowledgement, SMS attempts, provider outcomes or request counts.
	 *
	 * @return array<string,mixed>
	 */
	public function serialise_public_recovery( ?object $row ): array {
		$recovery = $this->serialise_recovery( $row );
		$status   = (string) ( $recovery['status'] ?? 'idle' );
		if ( 'acknowledged' === $status ) {
			$status = 'requested';
		}

		return array(
			'status'       => $status,
			'request_id'   => $recovery['request_id'] ?? null,
			'requested_at' => $recovery['requested_at'] ?? null,
			'resumed_at'   => $recovery['resumed_at'] ?? null,
		);
	}

	/** @return array<string,mixed> */
	private function public_request_data( ?object $row ): array {
		$recovery = $this->serialise_public_recovery( $row );
		return array(
			'accepted'        => true,
			'request_id'      => $recovery['request_id'] ?? null,
			'requested_at'    => $recovery['requested_at'] ?? null,
			'status'          => $recovery['status'] ?? 'requested',
			'recovery_status' => $recovery['recovery_status'] ?? 'requested',
		);
	}

	/** @return array<string,mixed> */
	private function body( WP_REST_Request $request ): array {
		$json = $request->get_json_params();
		if ( is_array( $json ) ) {
			return $json;
		}
		$params = $request->get_body_params();
		return is_array( $params ) ? $params : array();
	}

	/** @param array<string,mixed> $body */
	private function writer_token( WP_REST_Request $request, array $body ): string {
		return trim( (string) ( $request->get_header( 'X-Halo-Writer' ) ?: ( $body['writer_token'] ?? $body['writer'] ?? '' ) ) );
	}

	private function request_ip(): string {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
		return (string) apply_filters( 'avenra_halo_v2_client_ip', $ip );
	}

	private function rate_limit( string $scope, string $identifier, int $limit, int $window ): bool {
		$scope = sanitize_key( $scope );
		try {
			$limit = (int) apply_filters( 'avenra_halo_v2_rate_limit_' . str_replace( '-', '_', $scope ), $limit );
		} catch ( Throwable $error ) {
			$limit = max( 1, $limit );
		}
		return $this->db->consume_rate_limit( $scope, $identifier, max( 1, $limit ), max( MINUTE_IN_SECONDS, $window ) );
	}

	private function cooldown_seconds(): int {
		try {
			$value = (int) apply_filters( 'avenra_halo_v2_guardian_recovery_cooldown', 90 );
		} catch ( Throwable $error ) {
			$value = 90;
		}
		return min( 15 * MINUTE_IN_SECONDS, max( 30, $value ) );
	}

	private function notification_delay(): int {
		try {
			$value = (int) apply_filters( 'avenra_halo_v2_guardian_sms_delay', 90 );
		} catch ( Throwable $error ) {
			$value = 90;
		}
		return min( 10 * MINUTE_IN_SECONDS, max( 30, $value ) );
	}

	public function stale_after_seconds(): int {
		try {
			$value = (int) apply_filters( 'avenra_halo_v2_guardian_stale_after', 90 );
		} catch ( Throwable $error ) {
			$value = 90;
		}
		return min( 10 * MINUTE_IN_SECONDS, max( 30, $value ) );
	}

	private function feed_is_stale( object $row ): bool {
		$last_ping = $this->timestamp( $row->last_ping_at ?? null );
		$reference = $last_ping > 0 ? $last_ping : $this->timestamp( $row->started_at ?? null );
		return $reference > 0 && $reference <= time() - $this->stale_after_seconds();
	}

	private function normalise_mobile( string $mobile ): string {
		$digits = preg_replace( '/\D+/', '', trim( $mobile ) );
		if ( ! is_string( $digits ) || '' === $digits ) {
			return '';
		}
		if ( str_starts_with( $digits, '00' ) ) {
			$digits = substr( $digits, 2 );
		} elseif ( str_starts_with( $digits, '0' ) ) {
			$digits = '44' . substr( $digits, 1 );
		}
		return preg_match( '/^[1-9]\d{9,14}$/', $digits ) ? $digits : '';
	}

	private function coordinate( mixed $value, float $min, float $max ): ?float {
		if ( ! is_numeric( $value ) ) {
			return null;
		}
		$number = (float) $value;
		return is_finite( $number ) && $number >= $min && $number <= $max ? $number : null;
	}

	private function number( mixed $value, float $min, float $max, float $default ): float {
		if ( ! is_numeric( $value ) || ! is_finite( (float) $value ) ) {
			return $default;
		}
		return min( $max, max( $min, (float) $value ) );
	}

	private function nullable_number( mixed $value, float $min, float $max ): string {
		if ( null === $value || '' === $value || ! is_numeric( $value ) || ! is_finite( (float) $value ) ) {
			return '';
		}
		return (string) min( $max, max( $min, (float) $value ) );
	}

	private function text( string $value, int $length ): string {
		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $length ) : substr( $value, 0, $length );
	}

	private function timestamp( mixed $value ): int {
		if ( null === $value || '' === trim( (string) $value ) ) {
			return 0;
		}
		$timestamp = strtotime( (string) $value . ' UTC' );
		return false === $timestamp ? 0 : $timestamp;
	}

	private function rfc3339( mixed $value ): ?string {
		$timestamp = $this->timestamp( $value );
		return $timestamp > 0 ? gmdate( DATE_RFC3339, $timestamp ) : null;
	}
}
