<?php

defined( 'ABSPATH' ) || exit;

/**
 * Short-lived bearer sessions used by WebToNative's native Background
 * Location add-on. The native HTTP client does not share Halo's HttpOnly
 * browser session, so it receives a narrow, ride-scoped writer token instead.
 */
final class Avenra_Halo_V2_Native_Ride {
	private const NS = 'avenra-halo/v2';
	private const METRES_PER_SECOND_TO_MPH = 2.2369362921;
	private const GPS_SPEED_CALIBRATION_FACTOR = 1.15;
	private static ?self $instance = null;
	private Avenra_Halo_V2_Database $db;
	private Avenra_Halo_V2_Auth $auth;

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
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'avenra_halo_v2_emergency_assist_consent_changed', array( $this, 'assist_consent_changed' ), 10, 2 );
	}

	/** Immediately stop native Emergency Assist monitoring after withdrawal. */
	public function assist_consent_changed( int $customer_id, bool $enabled ): void {
		global $wpdb;

		$customer_id = absint( $customer_id );
		if ( $enabled || $customer_id < 1 ) {
			return;
		}
		$native_table = $this->db->table( 'native_ride_sessions' );
		if ( $this->db->table_exists( $native_table ) ) {
			$wpdb->update( $native_table, array( 'monitoring_enabled' => 0 ), array( 'customer_id' => $customer_id ), array( '%d' ), array( '%d' ) );
		}
		$presence_table = $this->db->table( 'presence' );
		if ( $this->db->table_exists( $presence_table ) ) {
			$wpdb->update(
				$presence_table,
				array( 'is_riding' => 0, 'monitoring_enabled' => 0, 'client_ride_id' => null, 'ride_started_at' => null, 'speed_mph' => null, 'top_speed_mph' => null, 'latitude' => null, 'longitude' => null, 'accuracy_m' => null, 'heading' => null, 'updated_at' => current_time( 'mysql', true ) ),
				array( 'customer_id' => $customer_id )
			);
		}
	}

	public function register_routes(): void {
		register_rest_route(
			self::NS,
			'/native-ride/session',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'create_session' ),
				'permission_callback' => array( $this->auth, 'permission_authenticated' ),
			)
		);
		register_rest_route(
			self::NS,
			'/native-ride/session/(?P<session_id>[a-fA-F0-9-]{36})',
			array(
				'methods'             => 'DELETE',
				'callback'            => array( $this, 'end_session' ),
				'permission_callback' => array( $this->auth, 'permission_authenticated' ),
			)
		);
		register_rest_route(
			self::NS,
			'/native-ride/location',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'receive_location' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function create_session( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$customer_id = (int) $this->auth->customer_id();
		$session     = $this->auth->session();
		$body        = $this->request_body( $request );
		$ride_id     = sanitize_text_field( (string) ( $body['client_ride_id'] ?? $body['ride_id'] ?? '' ) );
		$table       = $this->db->table( 'native_ride_sessions' );

		if ( $customer_id < 1 || ! is_object( $session ) ) {
			return Avenra_Halo_V2_Response::error( 'authentication_required', __( 'Sign in before starting native ride tracking.', 'avenra-halo-v2' ), 401 );
		}
		if ( ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $ride_id ) ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_id_invalid', __( 'A stable ride identifier is required for background location.', 'avenra-halo-v2' ), 422 );
		}
		if ( ! $this->db->table_exists( $table ) ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_unavailable', __( 'Background ride tracking needs the latest Halo database update.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( ! $this->db->consume_rate_limit( 'native-ride-create', (string) $customer_id, 20, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_throttled', __( 'Please wait before starting another background ride session.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 60 ) );
		}

		$lock = $this->db->acquire_advisory_lock( 'native-ride-customer', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_busy', __( 'Halo is already updating this ride session. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		try {
			$now = current_time( 'mysql', true );
			// A customer can have only one native ride writer. Revocation happens
			// before the replacement token is issued, preventing an older app tab
			// from continuing to write a second location stream.
			$wpdb->delete( $table, array( 'customer_id' => $customer_id ), array( '%d' ) );

			try {
				$token = $this->base64url( random_bytes( 32 ) );
			} catch ( Throwable $error ) {
				return Avenra_Halo_V2_Response::error( 'native_ride_token_failed', __( 'Halo could not create a secure background ride token.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$public_id = wp_generate_uuid4();
			$lifetime  = max( HOUR_IN_SECONDS, min( DAY_IN_SECONDS, (int) apply_filters( 'avenra_halo_v2_native_ride_lifetime', 12 * HOUR_IN_SECONDS, $customer_id, $ride_id ) ) );
			$expires   = gmdate( 'Y-m-d H:i:s', time() + $lifetime );
			$monitoring = Avenra_Halo_V2_Emergency::instance()->assist_consent( $customer_id ) ? 1 : 0;
			$created = $wpdb->insert(
				$table,
				array(
					'public_id'          => $public_id,
					'customer_id'        => $customer_id,
					'auth_session_id'    => (int) $session->id,
					'client_ride_id'     => $ride_id,
					'token_hash'         => $this->token_hash( $token ),
					'monitoring_enabled' => $monitoring,
					'started_at'         => $now,
					'expires_at'         => $expires,
					'last_sequence'      => 0,
				),
				array( '%s', '%d', '%d', '%s', '%s', '%d', '%s', '%s', '%d' )
			);
			if ( false === $created ) {
				return Avenra_Halo_V2_Response::error( 'native_ride_create_failed', __( 'Halo could not start background ride tracking.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}

			return Avenra_Halo_V2_Response::success(
				array(
					'session_id'    => $public_id,
					'writer_token'  => $token,
					'client_ride_id'=> $ride_id,
					'api_url'       => esc_url_raw( rest_url( self::NS . '/native-ride/location' ) ),
					'expires_at'    => gmdate( DATE_RFC3339, strtotime( $expires . ' UTC' ) ),
					'monitoring'    => (bool) $monitoring,
				)
			);
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function end_session( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$session_id  = sanitize_text_field( (string) $request['session_id'] );
		$customer_id = (int) $this->auth->customer_id();
		$native_table = $this->db->table( 'native_ride_sessions' );
		$tracking_table = $this->db->table( 'live_tracking' );
		$native_lock = $this->db->acquire_advisory_lock( 'native-ride-customer', (string) $customer_id, 2 );
		if ( ! $native_lock ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_busy', __( 'Halo is already updating this ride session. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		$test_lock = null;
		try {
			$test_lock = $this->db->acquire_advisory_lock( 'test-ride-monitoring', (string) $customer_id, 2 );
			if ( ! $test_lock ) {
				return Avenra_Halo_V2_Response::error( 'native_ride_busy', __( 'Halo is already securing test-ride monitoring. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
			}
			if ( false === $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'native_ride_end_failed', __( 'Halo could not start a protected ride shutdown.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT auth_session_id, client_ride_id FROM `' . esc_sql( $native_table ) . '` WHERE public_id = %s AND customer_id = %d LIMIT 1 FOR UPDATE', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$session_id,
					$customer_id
				)
			);
			$deleted = $wpdb->delete(
				$native_table,
				array( 'public_id' => $session_id, 'customer_id' => $customer_id ),
				array( '%s', '%d' )
			);
			if ( false === $deleted ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'native_ride_end_failed', __( 'Halo could not end background ride tracking.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}

			$tracking_ready = $this->db->table_exists( $tracking_table )
				&& $this->db->has_column( $tracking_table, 'tracking_mode' )
				&& $this->db->has_column( $tracking_table, 'auth_session_id' )
				&& $this->db->has_column( $tracking_table, 'client_ride_id' )
				&& $this->db->has_column( $tracking_table, 'ended_reason' );
			if ( is_object( $row ) && $tracking_ready ) {
				$ended = $wpdb->query(
					$wpdb->prepare(
						'UPDATE `' . esc_sql( $tracking_table ) . '` SET ended_at = %s, ended_reason = %s WHERE customer_id = %d AND auth_session_id = %d AND client_ride_id = %s AND tracking_mode = %s AND ended_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						current_time( 'mysql', true ),
						'native_ride_ended',
						$customer_id,
						(int) $row->auth_session_id,
						(string) $row->client_ride_id,
						'test_ride'
					)
				);
				if ( false === $ended ) {
					$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
					return Avenra_Halo_V2_Response::error( 'native_ride_end_failed', __( 'Halo could not stop the linked test-ride monitor.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
				}
			}
			if ( false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'native_ride_end_failed', __( 'Halo could not confirm that ride tracking ended.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			return Avenra_Halo_V2_Response::success( array( 'ended' => true, 'session_id' => $session_id ) );
		} finally {
			if ( $test_lock ) {
				$this->db->release_advisory_lock( $test_lock );
			}
			$this->db->release_advisory_lock( $native_lock );
		}
	}

	public function receive_location( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body       = $this->request_body( $request );
		$session_id = sanitize_text_field( (string) ( $body['session_id'] ?? $body['native_session_id'] ?? '' ) );
		$token      = trim( (string) ( $body['writer_token'] ?? $body['token'] ?? '' ) );
		$table      = $this->db->table( 'native_ride_sessions' );
		if ( ! preg_match( '/^[a-fA-F0-9-]{36}$/', $session_id ) || ! preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $token ) ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_token_invalid', __( 'This background ride token is invalid.', 'avenra-halo-v2' ), 401 );
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $table ) . '` WHERE public_id = %s AND expires_at > %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$session_id,
				current_time( 'mysql', true )
			)
		);
		if ( ! $row || ! hash_equals( (string) $row->token_hash, $this->token_hash( $token ) ) ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_token_invalid', __( 'This background ride session has ended or expired.', 'avenra-halo-v2' ), 401 );
		}
		$browser_session_active = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT id FROM `' . esc_sql( $this->db->table( 'sessions' ) ) . '` WHERE id = %d AND customer_id = %d AND revoked_at IS NULL AND expires_at > %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				(int) $row->auth_session_id,
				(int) $row->customer_id,
				current_time( 'mysql', true )
			)
		);
		if ( $browser_session_active < 1 ) {
			$wpdb->delete( $table, array( 'id' => (int) $row->id ), array( '%d' ) );
			return Avenra_Halo_V2_Response::error( 'native_ride_token_invalid', __( 'This background ride session has ended or expired.', 'avenra-halo-v2' ), 401 );
		}
		if ( ! $this->db->consume_rate_limit( 'native-ride-location', (string) $row->id, 1800, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_location_throttled', __( 'Background locations are arriving too quickly.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 2 ) );
		}

		$location = is_array( $body['location'] ?? null ) ? $body['location'] : $body;
		$lat      = $this->coordinate( $location['latitude'] ?? $location['lat'] ?? null, -90, 90 );
		$lng      = $this->coordinate( $location['longitude'] ?? $location['lng'] ?? $location['lon'] ?? null, -180, 180 );
		if ( null === $lat || null === $lng ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_location_invalid', __( 'The native location did not contain valid coordinates.', 'avenra-halo-v2' ), 422 );
		}
		$recorded_at = $this->recorded_at( $location['timestamp'] ?? $location['recorded_at'] ?? $body['timestamp'] ?? null );
		if ( $recorded_at < time() - 15 * MINUTE_IN_SECONDS || $recorded_at > time() + 5 * MINUTE_IN_SECONDS ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_location_stale', __( 'The native location timestamp was outside the active safety window.', 'avenra-halo-v2' ), 409 );
		}
		$altitude = $this->number( $location['altitude'] ?? null, -1000, 20000 );
		$accuracy = $this->number( $location['horizontalAccuracy'] ?? $location['horizontal_accuracy'] ?? $location['accuracy'] ?? null, 0, 10000 );
		$heading  = $this->heading( $location['heading'] ?? $location['course'] ?? $location['direction'] ?? null );
		$speed_mps = $this->number( $location['speed'] ?? null, 0, 150 );
		$speed_mph = null === $speed_mps ? null : $speed_mps * self::METRES_PER_SECOND_TO_MPH * self::GPS_SPEED_CALIBRATION_FACTOR;
		$device_id = sanitize_text_field( (string) ( $body['deviceID'] ?? $body['device_id'] ?? $location['deviceID'] ?? '' ) );

		$lock = $this->db->acquire_advisory_lock( 'native-ride-session', (string) $row->id, 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'native_ride_busy', __( 'Halo is already recording this native location.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		$consent_lock = null;
		try {
			$current = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $table ) . '` WHERE id = %d AND expires_at > %s LIMIT 1', (int) $row->id, current_time( 'mysql', true ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( ! $current || ! hash_equals( (string) $current->token_hash, $this->token_hash( $token ) ) ) {
				return Avenra_Halo_V2_Response::error( 'native_ride_token_invalid', __( 'This background ride session has ended or expired.', 'avenra-halo-v2' ), 401 );
			}
			$session_started_at = strtotime( (string) $current->started_at . ' UTC' );
			$last_recorded_at   = ! empty( $current->last_recorded_at ) ? strtotime( (string) $current->last_recorded_at . ' UTC' ) : false;
			if ( ( false !== $session_started_at && $recorded_at < $session_started_at - 30 ) || ( false !== $last_recorded_at && $recorded_at <= $last_recorded_at ) ) {
				return Avenra_Halo_V2_Response::success(
					array( 'accepted' => false, 'ignored' => true, 'reason' => 'out_of_order', 'sequence' => (int) $current->last_sequence )
				);
			}
			// A grant can only lose monitoring authority during a ride. Re-enabling
			// Emergency Assist requires a new ride session rather than silently
			// reviving an older native writer.
			if ( '1' === (string) $current->monitoring_enabled ) {
				$consent_lock = $this->db->acquire_advisory_lock( 'emergency-consent', (string) $current->customer_id, 2 );
				if ( ! $consent_lock ) {
					return Avenra_Halo_V2_Response::error( 'native_ride_consent_busy', __( 'Emergency Assist privacy settings are changing. Retry this location shortly.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
				}
			}
			$current_consent = $consent_lock && Avenra_Halo_V2_Emergency::instance()->assist_consent( (int) $current->customer_id );
			$monitoring_enabled = '1' === (string) $current->monitoring_enabled && $current_consent ? 1 : 0;
			$current->monitoring_enabled = $monitoring_enabled;
			$sequence = (int) $current->last_sequence + 1;
			$saved = $wpdb->update(
				$table,
				array(
					'last_ping_at'     => current_time( 'mysql', true ),
					'last_recorded_at' => gmdate( 'Y-m-d H:i:s', $recorded_at ),
					'last_sequence'    => $sequence,
					'monitoring_enabled'=> $monitoring_enabled,
					'latitude'         => $lat,
					'longitude'        => $lng,
					'altitude'         => $altitude,
					'accuracy_m'       => $accuracy,
					'heading'          => $heading,
					'speed_mph'        => $speed_mph,
					'device_id'        => substr( $device_id, 0, 190 ),
				),
				array( 'id' => (int) $current->id )
			);
			if ( false === $saved ) {
				return Avenra_Halo_V2_Response::error( 'native_ride_location_save_failed', __( 'Halo could not save the native location.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$this->update_live_shares( $current, $sequence, $lat, $lng, $speed_mph, $heading, $accuracy );
			$this->update_presence( $current, $lat, $lng, $speed_mph, $heading, $accuracy );
			$this->update_active_incident( $current, $lat, $lng, $speed_mph, $heading, $accuracy, $altitude, $recorded_at );
		} finally {
			if ( $consent_lock ) {
				$this->db->release_advisory_lock( $consent_lock );
			}
			$this->db->release_advisory_lock( $lock );
		}

		return Avenra_Halo_V2_Response::success( array( 'accepted' => true, 'sequence' => $sequence ) );
	}

	private function update_live_shares( object $session, int $sequence, float $lat, float $lng, ?float $speed_mph, ?float $heading, ?float $accuracy ): void {
		global $wpdb;
		$table = $this->db->table( 'live_tracking' );
		if ( ! $this->db->table_exists( $table )
			|| ! $this->db->has_column( $table, 'tracking_mode' )
			|| ! $this->db->has_column( $table, 'auth_session_id' )
			|| ! $this->db->has_column( $table, 'client_ride_id' ) ) {
			return;
		}
		$now = current_time( 'mysql', true );
		$set  = array( 'latitude = %f', 'longitude = %f' );
		$args = array( $lat, $lng );
		if ( null !== $speed_mph ) {
			$set[]  = 'speed_mph = %f';
			$set[]  = 'top_speed_mph = GREATEST(top_speed_mph,%f)';
			$args[] = $speed_mph;
			$args[] = $speed_mph;
		}
		if ( null !== $heading ) {
			$set[]  = 'heading = %f';
			$args[] = $heading;
		}
		if ( null !== $accuracy ) {
			$set[]  = 'accuracy_m = %f';
			$args[] = $accuracy;
		}
		$set[]  = 'last_ping_at = %s';
		// Rider-share links retain the established native sequence behaviour. The
		// authenticated test-ride endpoint owns its own ordered browser sequence,
		// so a background native sample must not move that counter ahead and cause
		// otherwise-fresh foreground samples to be rejected as stale.
		$set[]  = 'last_sequence = IF(tracking_mode = %s,GREATEST(last_sequence,%d),last_sequence)';
		$args[] = $now;
		$args[] = 'rider_share';
		$args[] = $sequence;
		$args[] = (int) $session->customer_id;
		$args[] = 'rider_share';
		$args[] = 'test_ride';
		$args[] = (int) $session->auth_session_id;
		$args[] = (string) $session->client_ride_id;
		$args[] = $now;
		$sql = 'UPDATE `' . esc_sql( $table ) . '` SET ' . implode( ', ', $set ) . ' WHERE customer_id = %d AND (tracking_mode = %s OR (tracking_mode = %s AND auth_session_id = %d AND client_ride_id = %s)) AND ended_at IS NULL AND expires_at > %s';
		$wpdb->query( $wpdb->prepare( $sql, $args ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	private function update_presence( object $session, float $lat, float $lng, ?float $speed_mph, ?float $heading, ?float $accuracy ): void {
		global $wpdb;
		if ( '1' !== (string) $session->monitoring_enabled ) {
			return;
		}
		$table = $this->db->table( 'presence' );
		if ( ! $this->db->table_exists( $table ) ) {
			return;
		}
		$wpdb->update(
			$table,
			array(
				'is_riding'    => 1,
				'latitude'     => $lat,
				'longitude'    => $lng,
				'speed_mph'    => $speed_mph,
				'heading'      => $heading,
				'accuracy_m'   => $accuracy,
				'last_ping_at' => current_time( 'mysql', true ),
				'updated_at'   => current_time( 'mysql', true ),
			),
			array( 'session_id' => (int) $session->auth_session_id, 'customer_id' => (int) $session->customer_id )
		);
	}

	private function update_active_incident( object $session, float $lat, float $lng, ?float $speed_mph, ?float $heading, ?float $accuracy, ?float $altitude, int $recorded_at ): void {
		global $wpdb;
		if ( '1' !== (string) $session->monitoring_enabled ) {
			return;
		}
		if ( ! $this->db->has_column( $this->db->table( 'incidents' ), 'client_ride_id' ) ) {
			return;
		}
		$incident = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT client_event_id FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE customer_id = %d AND client_ride_id = %s AND status IN ('active','acknowledged') AND activated_at IS NOT NULL AND activated_at >= %s ORDER BY id DESC LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				(int) $session->customer_id,
				(string) $session->client_ride_id,
				(string) $session->started_at
			)
		);
		if ( ! $incident ) {
			return;
		}
		$position = array(
			'lat'          => $lat,
			'lng'          => $lng,
			'recorded_at'  => $recorded_at * 1000,
			'source'       => 'webtonative-background-location',
			'device_state' => array( 'native_background_location' => true ),
		);
		foreach ( array( 'accuracy_m' => $accuracy, 'altitude' => $altitude, 'heading' => $heading, 'speed_mph' => $speed_mph ) as $key => $value ) {
			if ( null !== $value ) {
				$position[ $key ] = $value;
			}
		}
		Avenra_Halo_V2_Emergency::instance()->update_position(
			(int) $session->customer_id,
			(string) $incident->client_event_id,
			$position
		);
	}

	/** @return array<string,mixed> */
	private function request_body( WP_REST_Request $request ): array {
		$json = $request->get_json_params();
		$body = is_array( $json ) ? $json : $request->get_params();
		$body = is_array( $body ) ? $body : array();
		$data = $body['data'] ?? null;
		if ( is_string( $data ) ) {
			$decoded = json_decode( $data, true );
			$data = is_array( $decoded ) ? $decoded : null;
		}
		if ( is_array( $data ) ) {
			$body = array_merge( $body, $data );
		}
		return $body;
	}

	private function coordinate( mixed $value, float $min, float $max ): ?float {
		if ( ! is_numeric( $value ) ) {
			return null;
		}
		$number = (float) $value;
		return is_finite( $number ) && $number >= $min && $number <= $max ? $number : null;
	}

	private function number( mixed $value, float $min, float $max ): ?float {
		return $this->coordinate( $value, $min, $max );
	}

	private function heading( mixed $value ): ?float {
		$numeric = $this->number( $value, 0, 360 );
		if ( null !== $numeric ) {
			return $numeric;
		}
		$cardinal = strtoupper( trim( sanitize_text_field( (string) $value ) ) );
		$headings = array( 'N' => 0.0, 'NE' => 45.0, 'E' => 90.0, 'SE' => 135.0, 'S' => 180.0, 'SW' => 225.0, 'W' => 270.0, 'NW' => 315.0 );
		return $headings[ $cardinal ] ?? null;
	}

	private function recorded_at( mixed $value ): int {
		if ( is_numeric( $value ) ) {
			$numeric = (float) $value;
			return (int) ( $numeric > 100000000000 ? $numeric / 1000 : $numeric );
		}
		$parsed = is_string( $value ) ? strtotime( $value ) : false;
		return false === $parsed ? time() : (int) $parsed;
	}

	private function token_hash( string $token ): string {
		return hash_hmac( 'sha256', $token, wp_salt( 'auth' ) );
	}

	private function base64url( string $bytes ): string {
		return rtrim( strtr( base64_encode( $bytes ), '+/', '-_' ), '=' );
	}

	public function cleanup(): void {
		global $wpdb;
		$table = $this->db->table( 'native_ride_sessions' );
		if ( $this->db->table_exists( $table ) ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . esc_sql( $table ) . '` WHERE expires_at < %s', current_time( 'mysql', true ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
	}
}
