<?php

defined( 'ABSPATH' ) || exit;

/**
 * Private, incident-bound video evidence storage.
 *
 * Important trust boundaries:
 * - A rider may obtain a short-lived grant while an incident is a candidate,
 *   allowing the frozen on-device ring buffer to be prepared immediately.
 * - No video byte is accepted until the same incident is durably active or
 *   acknowledged. Cancelled candidates and false alarms are purged.
 * - Files are not WordPress attachments and have no public URL. Every read is
 *   authorised, audited and streamed through PHP (including byte ranges).
 */
final class Avenra_Halo_V2_Incident_Media {
	private const NS                       = 'avenra-halo/v2';
	private const SCHEMA_VERSION           = '2';
	private const INSTALL_RETRY_TRANSIENT  = 'avenra_halo_v2_incident_media_install_retry';
	private const INSTALL_RETRY_SECONDS    = 300;
	private const MAX_SEGMENTS_PER_CAMERA  = 6;
	private const MAX_DURATION_MS          = 12000;
	private const MAX_DURATION_DRIFT_MS    = 3000;
	private const MAX_ACCEPTED_DURATION_MS = self::MAX_DURATION_MS + self::MAX_DURATION_DRIFT_MS;
	private const MAX_TOTAL_DURATION_MS    = 65000;
	private const RESPONDER_COOKIE         = '__Host-avenra_halo_v2_emergency';

	private static ?self $instance = null;
	private Avenra_Halo_V2_Database $db;
	private Avenra_Halo_V2_Auth $auth;
	private bool $booted = false;
	private ?string $storage_root = null;

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

		add_action( 'plugins_loaded', array( $this, 'maybe_install' ), 21 );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_filter( 'rest_pre_serve_request', array( $this, 'serve_private_media' ), 8, 4 );
		add_action( 'avenra_halo_v2_cleanup', array( $this, 'cleanup' ), 30 );
		// This catches the same request that changes an incident to cancelled or
		// false_alarm without adding latency to the life-safety response itself.
		add_action( 'shutdown', array( $this, 'shutdown_purge_invalid_incidents' ), 1 );
	}

	/** Create this component's deliberately separate schema and storage. */
	public static function install(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$self    = self::instance();
		$charset = $wpdb->get_charset_collate();

		$grants = $self->grants_table();
		$media  = $self->media_table();
		$errors = array();
		$wpdb->last_error = '';
		dbDelta(
			"CREATE TABLE {$grants} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				incident_id bigint(20) unsigned NOT NULL,
				customer_id bigint(20) unsigned NOT NULL,
				session_id bigint(20) unsigned NOT NULL,
				client_ride_id varchar(80) NOT NULL,
				token_hash char(64) NOT NULL,
				status varchar(20) NOT NULL DEFAULT 'active',
				expected_front tinyint(3) unsigned NOT NULL DEFAULT 0,
				expected_rear tinyint(3) unsigned NOT NULL DEFAULT 0,
				created_at datetime NOT NULL,
				last_used_at datetime DEFAULT NULL,
				finalized_at datetime DEFAULT NULL,
				expires_at datetime NOT NULL,
				revoked_at datetime DEFAULT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY token_hash (token_hash),
				KEY incident_status (incident_id,status),
				KEY customer_session (customer_id,session_id),
				KEY expires_at (expires_at)
			) {$charset};"
		);
		if ( '' !== trim( (string) $wpdb->last_error ) ) {
			$errors[] = 'grants_migration_failed';
		}
		$wpdb->last_error = '';
		dbDelta(
			"CREATE TABLE {$media} (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				public_id char(36) NOT NULL,
				incident_id bigint(20) unsigned NOT NULL,
				customer_id bigint(20) unsigned NOT NULL,
				grant_id bigint(20) unsigned NOT NULL,
				camera_role varchar(8) NOT NULL,
				segment_index tinyint(3) unsigned NOT NULL,
				client_segment_id varchar(80) DEFAULT NULL,
				storage_key varchar(255) NOT NULL,
				mime_type varchar(100) NOT NULL,
				container varchar(8) NOT NULL,
				file_size bigint(20) unsigned NOT NULL,
				sha256 char(64) NOT NULL,
				duration_ms int(10) unsigned NOT NULL,
				captured_at datetime DEFAULT NULL,
				upload_status varchar(20) NOT NULL DEFAULT 'quarantined',
				verification_status varchar(24) NOT NULL DEFAULT 'pending',
				upload_error_code varchar(48) DEFAULT NULL,
				retain_until datetime NOT NULL,
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				deleted_at datetime DEFAULT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY public_id (public_id),
				UNIQUE KEY incident_camera_segment (incident_id,camera_role,segment_index),
				KEY incident_status (incident_id,upload_status),
				KEY customer_created (customer_id,created_at),
				KEY retain_until (retain_until)
			) {$charset};"
		);
		if ( '' !== trim( (string) $wpdb->last_error ) ) {
			$errors[] = 'media_migration_failed';
		}

		if ( empty( $errors ) && $self->main_camera_schema_ready() && $self->schema_ready() ) {
			update_option( 'avenra_halo_v2_incident_media_schema_version', self::SCHEMA_VERSION, false );
			delete_transient( self::INSTALL_RETRY_TRANSIENT );
			$self->ensure_storage_root();
		} else {
			delete_option( 'avenra_halo_v2_incident_media_schema_version' );
			set_transient( self::INSTALL_RETRY_TRANSIENT, time(), self::INSTALL_RETRY_SECONDS );
			do_action( 'avenra_halo_v2_incident_media_schema_error', array_values( array_unique( array_merge( $errors, array( 'schema_verification_failed' ) ) ) ) );
		}
	}

	public function maybe_install(): void {
		$version_ready  = self::SCHEMA_VERSION === (string) get_option( 'avenra_halo_v2_incident_media_schema_version', '' );
		$main_ready     = $this->main_camera_schema_ready();
		$incident_ready = $this->schema_ready();
		$retry_pending  = false !== get_transient( self::INSTALL_RETRY_TRANSIENT );
		if ( $version_ready && $main_ready && $incident_ready ) {
			if ( $retry_pending ) {
				delete_transient( self::INSTALL_RETRY_TRANSIENT );
			}
			return;
		}
		// Schema inspection is cheap enough to fail closed on every request, but
		// dbDelta across the complete Halo schema is not. This transient also keeps
		// concurrent requests from starting the same best-effort repair together.
		if ( $retry_pending ) {
			return;
		}
		set_transient( self::INSTALL_RETRY_TRANSIENT, time(), self::INSTALL_RETRY_SECONDS );

		// Emergency-camera consent columns and incidents.client_ride_id belong to
		// the main database installer, not this component's two private tables.
		if ( ! $main_ready ) {
			Avenra_Halo_V2_Database::install();
			$main_ready = $this->main_camera_schema_ready();
		}
		if ( ! $version_ready || ! $incident_ready ) {
			self::install();
		}

		$version_ready  = self::SCHEMA_VERSION === (string) get_option( 'avenra_halo_v2_incident_media_schema_version', '' );
		$incident_ready = $this->schema_ready();
		if ( $version_ready && $main_ready && $incident_ready ) {
			delete_transient( self::INSTALL_RETRY_TRANSIENT );
		}
	}

	public function register_routes(): void {
		$rider_permission = array( $this->auth, 'permission_authenticated' );
		register_rest_route(
			self::NS,
			'/safety/incident-camera',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'camera_settings' ),
					'permission_callback' => $rider_permission,
				),
				array(
					'methods'             => array( 'PATCH', 'PUT' ),
					'callback'            => array( $this, 'update_camera_settings' ),
					'permission_callback' => $rider_permission,
				),
			)
		);
		register_rest_route(
			self::NS,
			'/safety/incidents/(?P<event_id>[A-Za-z0-9._:-]{8,80})/media-grant',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'issue_upload_grant' ),
				'permission_callback' => $rider_permission,
			)
		);
		register_rest_route(
			self::NS,
			'/safety/incidents/(?P<event_id>[A-Za-z0-9._:-]{8,80})/media',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'rider_media_status' ),
				'permission_callback' => $rider_permission,
			)
		);
		register_rest_route(
			self::NS,
			'/safety/incidents/(?P<event_id>[A-Za-z0-9._:-]{8,80})/media/segments',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'upload_segment' ),
				'permission_callback' => $rider_permission,
			)
		);
		register_rest_route(
			self::NS,
			'/safety/incidents/(?P<event_id>[A-Za-z0-9._:-]{8,80})/media/finalize',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'finalize_upload' ),
				'permission_callback' => $rider_permission,
			)
		);

		register_rest_route(
			self::NS,
			'/operations/incidents/(?P<incident_id>[a-fA-F0-9-]{36})/media',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'operator_media_list' ),
				'permission_callback' => array( $this, 'permission_operator' ),
			)
		);
		register_rest_route(
			self::NS,
			'/operations/incidents/(?P<incident_id>[a-fA-F0-9-]{36})/media/(?P<media_id>[a-fA-F0-9-]{36})/(?P<delivery>stream|download)',
			array(
				'methods'             => array( 'GET', 'HEAD' ),
				'callback'            => array( $this, 'operator_media_file' ),
				'permission_callback' => array( $this, 'permission_operator' ),
			)
		);

		register_rest_route(
			self::NS,
			'/responders/incidents/(?P<incident_id>[a-fA-F0-9-]{36})/media',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'responder_media_list' ),
				'permission_callback' => array( $this, 'permission_responder' ),
			)
		);
		register_rest_route(
			self::NS,
			'/responders/incidents/(?P<incident_id>[a-fA-F0-9-]{36})/media/(?P<media_id>[a-fA-F0-9-]{36})/(?P<delivery>stream|download)',
			array(
				'methods'             => array( 'GET', 'HEAD' ),
				'callback'            => array( $this, 'responder_media_file' ),
				'permission_callback' => array( $this, 'permission_responder' ),
			)
		);
	}

	/** Current explicit incident-camera wording identifier. */
	public function required_camera_consent_version(): string {
		$version = sanitize_text_field( (string) apply_filters( 'avenra_halo_v2_incident_camera_consent_version', '1' ) );
		return '' !== $version ? substr( $version, 0, 32 ) : '1';
	}

	/**
	 * Return fail-closed privacy settings. Camera and dual-camera recording are
	 * intentionally opt-in and cannot be inferred from Emergency Assist consent.
	 *
	 * @return array<string,mixed>
	 */
	public function get_camera_settings( int $customer_id ): array {
		global $wpdb;

		$required = $this->required_camera_consent_version();
		$readiness = $this->camera_backend_readiness();
		$defaults = array(
			'enabled'                  => false,
			'stored_enabled'           => false,
			'dual_enabled'             => false,
			'stored_dual_enabled'      => false,
			'audio_enabled'            => false,
			'rolling_seconds'          => 60,
			'consent_current'          => false,
			'renewal_required'         => false,
			'consent_version'          => '',
			'required_consent_version' => $required,
			'consented_at'             => null,
			'revoked_at'               => null,
			'provider_ready'            => $readiness['provider_ready'],
			'storage_ready'             => $readiness['storage_ready'],
			'readiness_reason'          => $readiness['readiness_reason'],
			'readiness_reasons'         => $readiness['readiness_reasons'],
		);
		if ( $customer_id < 1 || ! $this->camera_settings_storage_ready() ) {
			return $defaults;
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT incident_camera_enabled, incident_camera_dual_enabled, incident_camera_consent_version, incident_camera_consented_at, incident_camera_revoked_at FROM `" . esc_sql( $this->db->table( 'emergency_settings' ) ) . "` WHERE customer_id = %d LIMIT 1",
				$customer_id
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( ! is_object( $row ) ) {
			return $defaults;
		}
		$enabled = '1' === (string) $row->incident_camera_enabled;
		$version = substr( sanitize_text_field( (string) $row->incident_camera_consent_version ), 0, 32 );
		$current = $enabled && '' !== $version && hash_equals( $required, $version );
		return array(
			'enabled'                  => $current,
			'stored_enabled'           => $enabled,
			'dual_enabled'             => $current && '1' === (string) $row->incident_camera_dual_enabled,
			'stored_dual_enabled'      => '1' === (string) $row->incident_camera_dual_enabled,
			'audio_enabled'            => false,
			'rolling_seconds'          => 60,
			'consent_current'          => $current,
			'renewal_required'         => $enabled && ! $current,
			'consent_version'          => $version,
			'required_consent_version' => $required,
			'consented_at'             => $this->rfc3339( $row->incident_camera_consented_at ?? null ),
			'revoked_at'               => $this->rfc3339( $row->incident_camera_revoked_at ?? null ),
			'provider_ready'            => $readiness['provider_ready'],
			'storage_ready'             => $readiness['storage_ready'],
			'readiness_reason'          => $readiness['readiness_reason'],
			'readiness_reasons'         => $readiness['readiness_reasons'],
		);
	}

	/**
	 * Save explicit privacy choices. Revocation invalidates outstanding upload
	 * grants, but confirmed evidence already stored follows its normal retention.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public function set_camera_settings( int $customer_id, bool $enabled, bool $dual_enabled, string $consent_version = '' ): array|WP_Error {
		global $wpdb;

		if ( $customer_id < 1 || ! $this->db->customer_by_id( $customer_id ) ) {
			return new WP_Error( 'incident_camera_customer_missing', __( 'The Halo customer could not be found.', 'avenra-halo-v2' ) );
		}
		if ( ! $this->camera_settings_storage_ready() ) {
			return new WP_Error( 'incident_camera_storage_unavailable', __( 'Incident-camera privacy storage is not ready.', 'avenra-halo-v2' ) );
		}
		$required = $this->required_camera_consent_version();
		$supplied = substr( sanitize_text_field( trim( $consent_version ) ), 0, 32 );
		if ( $enabled && ( '' === $supplied || ! hash_equals( $required, $supplied ) ) ) {
			return new WP_Error(
				'incident_camera_consent_version_required',
				__( 'Review and accept the current incident-camera privacy wording before enabling recording.', 'avenra-halo-v2' ),
				array( 'required_consent_version' => $required )
			);
		}
		$dual_enabled = $enabled && $dual_enabled;
		// Emergency Assist consent is the parent permission. Always acquire its
		// lock first, then the narrower camera lock, so no caller can deadlock by
		// observing or changing the two choices in the opposite order.
		$assist_lock = $this->db->acquire_advisory_lock( 'emergency-consent', (string) $customer_id, 2 );
		if ( ! $assist_lock ) {
			return new WP_Error( 'incident_camera_assist_busy', __( 'Emergency Assist settings are already being updated.', 'avenra-halo-v2' ) );
		}
		$camera_lock = $this->db->acquire_advisory_lock( 'incident-camera-consent', (string) $customer_id, 2 );
		if ( ! $camera_lock ) {
			$this->db->release_advisory_lock( $assist_lock );
			return new WP_Error( 'incident_camera_consent_busy', __( 'Incident-camera privacy settings are already being updated.', 'avenra-halo-v2' ) );
		}
		try {
			// The pre-lock REST checks are advisory. This is the durable parent-
			// consent boundary shared with Emergency Assist changes.
			if ( $enabled && ! Avenra_Halo_V2_Emergency::instance()->assist_consent( $customer_id ) ) {
				return new WP_Error( 'incident_camera_assist_required', __( 'Enable Emergency Assist before enabling incident-camera recording.', 'avenra-halo-v2' ) );
			}
			$previous = $this->get_camera_settings( $customer_id );
			$previous_enabled = ! empty( $previous['stored_enabled'] );
			$previous_dual    = ! empty( $previous['stored_dual_enabled'] );
			$previous_version = (string) ( $previous['consent_version'] ?? '' );
			$consent_renewal  = $enabled && ( ! $previous_enabled || ! hash_equals( $required, $previous_version ) );
			$revocation       = ! $enabled && $previous_enabled;
			$settings_changed = $previous_enabled !== $enabled
				|| $previous_dual !== $dual_enabled
				|| ( $enabled && ! hash_equals( $required, $previous_version ) );
			if ( ! $settings_changed ) {
				return $previous;
			}
			$requires_provider = $enabled && ( $consent_renewal || ( ! $previous_dual && $dual_enabled ) );
			if ( $requires_provider && ( empty( $previous['storage_ready'] ) || empty( $previous['provider_ready'] ) ) ) {
				$readiness = array(
					'provider_ready'    => ! empty( $previous['provider_ready'] ),
					'storage_ready'     => ! empty( $previous['storage_ready'] ),
					'readiness_reason'  => $previous['readiness_reason'] ?? 'provider_unavailable',
					'readiness_reasons' => $previous['readiness_reasons'] ?? array( 'provider_unavailable' ),
				);
				return new WP_Error( 'incident_camera_provider_unavailable', __( 'Incident-camera recording cannot be enabled until its secure evidence provider and storage are ready.', 'avenra-halo-v2' ), array( 'status' => 503, 'readiness' => $readiness ) );
			}

			$now  = current_time( 'mysql', true );
			$data     = array(
				'incident_camera_enabled'      => $enabled ? 1 : 0,
				'incident_camera_dual_enabled' => $dual_enabled ? 1 : 0,
				'updated_at'                   => $now,
			);
			if ( $consent_renewal ) {
				$data['incident_camera_consent_version'] = $required;
				$data['incident_camera_consented_at']    = $now;
				$data['incident_camera_revoked_at']      = null;
			} elseif ( $revocation ) {
				$data['incident_camera_revoked_at'] = $now;
			}
			$exists = (int) $wpdb->get_var( $wpdb->prepare( "SELECT customer_id FROM `" . esc_sql( $this->db->table( 'emergency_settings' ) ) . "` WHERE customer_id = %d LIMIT 1", $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( $exists > 0 ) {
				$saved = $wpdb->update( $this->db->table( 'emergency_settings' ), $data, array( 'customer_id' => $customer_id ) );
			} else {
				$data = array_merge(
					array(
						'customer_id'            => $customer_id,
						'assist_enabled'          => 0,
						'consent_version'         => '',
						'medical_sharing_enabled' => 0,
						'medical_consent_version' => '',
						'created_at'              => $now,
					),
					$data
				);
				$saved = $wpdb->insert( $this->db->table( 'emergency_settings' ), $data );
			}
			if ( false === $saved ) {
				return new WP_Error( 'incident_camera_consent_failed', __( 'Incident-camera privacy settings could not be saved.', 'avenra-halo-v2' ) );
			}
			$event_type = $revocation ? 'camera_revoked' : ( $consent_renewal && ! $previous_enabled ? 'camera_granted' : 'camera_updated' );
			if ( $this->db->table_exists( $this->db->table( 'consent_events' ) ) ) {
				$wpdb->insert(
					$this->db->table( 'consent_events' ),
					array(
						'customer_id'      => $customer_id,
						'event_type'       => $event_type,
						'previous_enabled' => $previous_enabled ? 1 : 0,
						'new_enabled'      => $enabled ? 1 : 0,
						'previous_version' => (string) ( $previous['consent_version'] ?? '' ),
						'new_version'      => $enabled ? $required : (string) ( $previous['consent_version'] ?? '' ),
						'occurred_at'      => $now,
					)
				);
			}
			if ( $revocation && $this->db->table_exists( $this->grants_table() ) ) {
				$wpdb->query( $wpdb->prepare( "UPDATE `" . esc_sql( $this->grants_table() ) . "` SET status = 'revoked', revoked_at = %s WHERE customer_id = %d AND status = 'active'", $now, $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			}
			return $this->get_camera_settings( $customer_id );
		} finally {
			$this->db->release_advisory_lock( $camera_lock );
			$this->db->release_advisory_lock( $assist_lock );
		}
	}

	public function camera_settings( WP_REST_Request $request ): WP_REST_Response {
		return $this->success( $this->get_camera_settings( $this->auth->customer_id() ) );
	}

	public function update_camera_settings( WP_REST_Request $request ): WP_REST_Response {
		$params  = $this->request_params( $request );
		$enabled = $this->boolean_value( $params['enabled'] ?? false );
		$dual    = $this->boolean_value( $params['dual_enabled'] ?? false );
		$result  = $this->set_camera_settings( $this->auth->customer_id(), $enabled, $dual, (string) ( $params['consent_version'] ?? '' ) );
		return is_wp_error( $result ) ? $this->error_from_wp_error( $result, 422 ) : $this->success( $result );
	}

	public function permission_operator( WP_REST_Request $request ): bool|WP_Error {
		if ( ! class_exists( 'Avenra_Halo_V2_Operations' ) ) {
			return new WP_Error( 'incident_media_operations_unavailable', __( 'Emergency Assist operations are unavailable.', 'avenra-halo-v2' ), array( 'status' => 503 ) );
		}
		return Avenra_Halo_V2_Operations::instance()->permission_view( $request );
	}

	/** Validate the incident-scoped HttpOnly responder session cookie. */
	public function permission_responder( WP_REST_Request $request ): bool|WP_Error {
		if ( ! $this->same_origin_read( $request ) ) {
			return new WP_Error( 'incident_media_origin_invalid', __( 'This evidence request did not originate from Halo.', 'avenra-halo-v2' ), array( 'status' => 403 ) );
		}
		$incident = $this->incident_by_public_id( strtolower( sanitize_text_field( (string) $request['incident_id'] ) ) );
		if ( ! $this->incident_can_be_viewed( $incident ) ) {
			return new WP_Error( 'incident_media_unavailable', __( 'Incident evidence is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		$role = $this->responder_role( $request );
		if ( ! in_array( $role, array( 'primary', 'backup' ), true ) ) {
			return new WP_Error( 'incident_media_responder_session_required', __( 'The responder session is unavailable.', 'avenra-halo-v2' ), array( 'status' => 401 ) );
		}
		$cookie_name = $this->responder_cookie_name( $incident, $role );
		$candidates  = array();
		if ( isset( $_COOKIE[ $cookie_name ] ) ) {
			$candidates[] = (string) wp_unslash( $_COOKIE[ $cookie_name ] );
		}
		if ( isset( $_COOKIE[ self::RESPONDER_COOKIE ] ) ) {
			$candidates[] = (string) wp_unslash( $_COOKIE[ self::RESPONDER_COOKIE ] );
		}
		$session_column = $role . '_session_hash';
		$expiry_column  = $role . '_expires_at';
		$expected_hash  = (string) ( $incident->{$session_column} ?? '' );
		$expiry         = strtotime( (string) ( $incident->{$expiry_column} ?? '' ) . ' UTC' );
		if ( '' === $expected_hash || false === $expiry || $expiry < time() ) {
			return new WP_Error( 'incident_media_responder_session_required', __( 'The responder session has expired.', 'avenra-halo-v2' ), array( 'status' => 401 ) );
		}
		foreach ( $candidates as $candidate ) {
			$token = trim( sanitize_text_field( $candidate ) );
			if ( preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $token ) && hash_equals( $expected_hash, $this->token_hash( $token ) ) ) {
				return true;
			}
		}
		return new WP_Error( 'incident_media_responder_session_required', __( 'The responder session is unavailable.', 'avenra-halo-v2' ), array( 'status' => 401 ) );
	}

	/**
	 * Issue a grant while candidate/active. The grant is preparation authority;
	 * upload_segment independently requires a durably activated incident.
	 */
	public function issue_upload_grant( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		if ( ! $this->storage_ready() || ! $this->ensure_storage_root() ) {
			return $this->error( 'incident_media_storage_unavailable', __( 'Secure incident storage is unavailable.', 'avenra-halo-v2' ), 503 );
		}
		$customer_id = $this->auth->customer_id();
		$camera_settings = $this->get_camera_settings( $customer_id );
		if ( empty( $camera_settings['consent_current'] ) ) {
			return $this->error( 'incident_camera_consent_required', __( 'Enable incident-camera recording under the current privacy wording before preparing footage.', 'avenra-halo-v2' ), 403, array( 'required_consent_version' => $camera_settings['required_consent_version'] ) );
		}
		if ( empty( $camera_settings['storage_ready'] ) || empty( $camera_settings['provider_ready'] ) ) {
			return $this->error( 'incident_camera_provider_unavailable', __( 'Secure incident-camera evidence storage is not ready.', 'avenra-halo-v2' ), 503, array( 'readiness_reason' => $camera_settings['readiness_reason'] ?? 'provider_unavailable', 'readiness_reasons' => $camera_settings['readiness_reasons'] ?? array() ) );
		}
		$incident    = $this->incident_by_event( $customer_id, (string) $request['event_id'] );
		if ( ! $incident || ! in_array( (string) $incident->status, array( 'candidate', 'active', 'acknowledged' ), true ) || '1' === (string) $incident->is_test ) {
			return $this->error( 'incident_media_incident_unavailable', __( 'A current confirmed Emergency Assist event is required.', 'avenra-halo-v2' ), 409 );
		}
		$session = $this->auth->session();
		if ( ! $session ) {
			return $this->error( 'incident_media_session_unavailable', __( 'Sign in to Halo again before preparing incident evidence.', 'avenra-halo-v2' ), 401 );
		}
		$body = $this->request_params( $request );
		$client_ride_id = sanitize_text_field( (string) ( $body['client_ride_id'] ?? $body['ride_id'] ?? '' ) );
		if ( ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $client_ride_id ) ) {
			return $this->error( 'incident_media_ride_required', __( 'The active ride identifier is required before preparing incident evidence.', 'avenra-halo-v2' ), 422 );
		}
		$incident_ride_id = sanitize_text_field( (string) ( $incident->client_ride_id ?? '' ) );
		if ( '' !== $incident_ride_id && ! hash_equals( $incident_ride_id, $client_ride_id ) ) {
			return $this->error( 'incident_media_ride_mismatch', __( 'This evidence grant does not match the ride that created the incident.', 'avenra-halo-v2' ), 409 );
		}
		if ( $this->db->table_exists( $this->db->table( 'presence' ) ) ) {
			$presence_ride_id = sanitize_text_field(
				(string) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT client_ride_id FROM `" . esc_sql( $this->db->table( 'presence' ) ) . "` WHERE session_id = %d AND customer_id = %d AND is_riding = 1 LIMIT 1",
						(int) $session->id,
						$customer_id
					)
				)
			); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( '' !== $presence_ride_id && ! hash_equals( $presence_ride_id, $client_ride_id ) ) {
				return $this->error( 'incident_media_ride_mismatch', __( 'This evidence grant does not match the ride active on this device.', 'avenra-halo-v2' ), 409 );
			}
		}
		$lock = $this->db->acquire_advisory_lock( 'incident-media-grant', (string) $incident->id, 2 );
		if ( ! $lock ) {
			return $this->error( 'incident_media_busy', __( 'Incident evidence is already being prepared. Please retry.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
			$incident = $this->incident_by_id( (int) $incident->id );
			if ( ! $incident || ! in_array( (string) $incident->status, array( 'candidate', 'active', 'acknowledged' ), true ) || '1' === (string) $incident->is_test ) {
				return $this->error( 'incident_media_incident_unavailable', __( 'This event can no longer accept incident evidence.', 'avenra-halo-v2' ), 409 );
			}
			$incident_ride_id = sanitize_text_field( (string) ( $incident->client_ride_id ?? '' ) );
			if ( '' !== $incident_ride_id && ! hash_equals( $incident_ride_id, $client_ride_id ) ) {
				return $this->error( 'incident_media_ride_mismatch', __( 'This evidence grant does not match the ride that created the incident.', 'avenra-halo-v2' ), 409 );
			}

			$now      = current_time( 'mysql', true );
			$existing = $wpdb->get_row(
				$wpdb->prepare(
					"SELECT * FROM `" . esc_sql( $this->grants_table() ) . "` WHERE incident_id = %d AND customer_id = %d AND session_id = %d AND client_ride_id = %s AND status = 'active' AND expires_at >= %s ORDER BY id DESC LIMIT 1",
					(int) $incident->id,
					$customer_id,
					(int) $session->id,
					$client_ride_id,
					$now
				)
			); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$presented_token = trim( (string) $request->get_header( 'X-Halo-Media-Token' ) );
			if ( is_object( $existing ) && preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $presented_token ) && hash_equals( (string) $existing->token_hash, $this->token_hash( $presented_token ) ) ) {
				return $this->upload_grant_response( $presented_token, (string) $existing->expires_at, $camera_settings, true, 200 );
			}

			$rate_scope = $customer_id . '|' . (int) $incident->id . '|' . (int) $session->id;
			if ( ! $this->db->consume_rate_limit( 'incident-media-grant-issue', $rate_scope, 6, 15 * MINUTE_IN_SECONDS ) ) {
				return $this->error( 'incident_media_grant_throttled', __( 'Too many evidence grants were requested for this ride. Please wait and retry.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 15 * MINUTE_IN_SECONDS ) );
			}
			$token = Avenra_Halo_V2_Auth::random_token( 32 );
			if ( strlen( $token ) < 40 ) {
				return $this->error( 'incident_media_token_unavailable', __( 'Halo could not create a secure evidence grant.', 'avenra-halo-v2' ), 503 );
			}
			$lifetime = $this->grant_lifetime();
			$expires  = gmdate( 'Y-m-d H:i:s', time() + $lifetime );
			if ( is_object( $existing ) ) {
				$saved = $wpdb->update(
					$this->grants_table(),
					array( 'token_hash' => $this->token_hash( $token ), 'last_used_at' => $now, 'expires_at' => $expires, 'revoked_at' => null ),
					array( 'id' => (int) $existing->id, 'status' => 'active' )
				);
			} else {
				$saved = $wpdb->insert(
					$this->grants_table(),
					array(
						'incident_id'    => (int) $incident->id,
						'customer_id'    => $customer_id,
						'session_id'     => (int) $session->id,
						'client_ride_id' => $client_ride_id,
						'token_hash'     => $this->token_hash( $token ),
						'status'         => 'active',
						'created_at'     => $now,
						'expires_at'     => $expires,
					)
				);
			}
			if ( false === $saved || ( is_object( $existing ) && 1 !== (int) $saved ) ) {
				return $this->error( 'incident_media_grant_failed', __( 'Halo could not save the secure evidence grant.', 'avenra-halo-v2' ), 503 );
			}
			Avenra_Halo_V2_Emergency::instance()->append_event(
				(int) $incident->id,
				is_object( $existing ) ? 'evidence_grant_rotated' : 'evidence_grant_issued',
				'rider',
				array( 'ride_id_hash' => substr( hash_hmac( 'sha256', $client_ride_id, wp_salt( 'auth' ) ), 0, 16 ), 'expires_in' => $lifetime )
			);
			return $this->upload_grant_response( $token, $expires, $camera_settings, is_object( $existing ), is_object( $existing ) ? 200 : 201 );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function upload_segment( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$grant = $this->upload_grant_for_request( $request, false );
		if ( is_wp_error( $grant ) ) {
			return $this->error_from_wp_error( $grant );
		}
		$incident = $grant['incident'];
		$camera_settings = $this->get_camera_settings( (int) $incident->customer_id );
		if ( empty( $camera_settings['consent_current'] ) ) {
			return $this->error( 'incident_camera_consent_required', __( 'Incident-camera consent is no longer current, so no further footage can be uploaded.', 'avenra-halo-v2' ), 403 );
		}
		if ( ! $this->incident_can_accept_upload( $incident ) ) {
			return $this->inactive_upload_response( $incident );
		}
		$files = $request->get_file_params();
		$file  = $files['segment'] ?? $files['file'] ?? null;
		if ( ! is_array( $file ) || empty( $file['tmp_name'] ) || UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
			return $this->error( 'incident_media_segment_missing', __( 'Choose a recorded video segment to upload.', 'avenra-halo-v2' ), 422 );
		}
		$max_bytes   = $this->max_segment_bytes();
		$actual_size = @filesize( (string) $file['tmp_name'] ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		$file_size   = false === $actual_size ? 0 : (int) $actual_size;
		if ( $file_size < 1 || $file_size > $max_bytes ) {
			return $this->error( 'incident_media_segment_too_large', __( 'This evidence segment is outside the permitted size.', 'avenra-halo-v2' ), 413, array( 'max_bytes' => $max_bytes ) );
		}
		$params = $this->request_params( $request );
		$camera = sanitize_key( (string) ( $params['camera_role'] ?? $params['camera'] ?? '' ) );
		$index  = isset( $params['segment_index'] ) && is_numeric( $params['segment_index'] ) ? (int) $params['segment_index'] : -1;
		$duration_ms = isset( $params['duration_ms'] ) && is_numeric( $params['duration_ms'] ) ? (int) round( (float) $params['duration_ms'] ) : 0;
		if ( ! in_array( $camera, array( 'rear', 'front' ), true ) ) {
			return $this->error( 'incident_media_camera_invalid', __( 'The evidence segment must identify the front or rear camera.', 'avenra-halo-v2' ), 422 );
		}
		if ( 'front' === $camera && empty( $camera_settings['dual_enabled'] ) ) {
			return $this->error( 'incident_camera_dual_consent_required', __( 'Front-facing incident recording has not been enabled.', 'avenra-halo-v2' ), 403 );
		}
		if ( $index < 0 || $index >= self::MAX_SEGMENTS_PER_CAMERA ) {
			return $this->error( 'incident_media_index_invalid', __( 'The evidence segment number is invalid.', 'avenra-halo-v2' ), 422 );
		}
		if ( $duration_ms < 100 || $duration_ms > self::MAX_DURATION_MS ) {
			return $this->error( 'incident_media_duration_invalid', __( 'Each evidence segment must be no longer than twelve seconds.', 'avenra-halo-v2' ), 422, array( 'max_duration_ms' => self::MAX_DURATION_MS ) );
		}
		$client_segment_id = sanitize_text_field( (string) ( $params['client_segment_id'] ?? '' ) );
		if ( '' !== $client_segment_id && ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $client_segment_id ) ) {
			return $this->error( 'incident_media_segment_id_invalid', __( 'The evidence segment identifier is invalid.', 'avenra-halo-v2' ), 422 );
		}
		$type = $this->inspect_video_type( (string) $file['tmp_name'], (string) ( $file['name'] ?? '' ), (string) ( $file['type'] ?? '' ) );
		if ( is_wp_error( $type ) ) {
			return $this->error_from_wp_error( $type );
		}
		$validation = $this->verify_video_segment(
			(string) $file['tmp_name'],
			$type,
			$duration_ms,
			$file_size,
			$camera,
			$incident
		);
		if ( is_wp_error( $validation ) ) {
			return $this->error_from_wp_error( $validation, 415 );
		}
		$verification = (string) $validation['verification_status'];
		// Prefer analyser-confirmed duration for quotas and persistence. The client
		// value remains a bounded preflight/fallback for a trusted external verifier
		// that cannot return duration metadata.
		$duration_ms = (int) ( $validation['duration_ms'] ?? $duration_ms );
		if ( ! $this->db->consume_rate_limit( 'incident-media-grant', (string) $grant['grant']->id, 48, HOUR_IN_SECONDS ) ) {
			return $this->error( 'incident_media_upload_throttled', __( 'Too many evidence upload attempts were received. Please wait and retry.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}

		$checksum = hash_file( 'sha256', (string) $file['tmp_name'] );
		if ( ! is_string( $checksum ) || 64 !== strlen( $checksum ) ) {
			return $this->error( 'incident_media_checksum_failed', __( 'Halo could not verify the evidence segment.', 'avenra-halo-v2' ), 500 );
		}
		// Consent revocation and final file persistence share this lock. The
		// earlier check is user-friendly preflight; this one is the durable edge.
		$consent_lock = $this->db->acquire_advisory_lock( 'incident-camera-consent', (string) $incident->customer_id, 2 );
		if ( ! $consent_lock ) {
			return $this->error( 'incident_media_consent_busy', __( 'Camera privacy settings are changing. Please retry this evidence segment.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		$lock = $this->db->acquire_advisory_lock( 'incident-media-upload', (string) $incident->id, 3 );
		if ( ! $lock ) {
			$this->db->release_advisory_lock( $consent_lock );
			return $this->error( 'incident_media_busy', __( 'Another evidence segment is being secured. Please retry.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
			$incident = $this->incident_by_id( (int) $incident->id );
			$camera_settings = $incident ? $this->get_camera_settings( (int) $incident->customer_id ) : array();
			if ( empty( $camera_settings['consent_current'] ) || ( 'front' === $camera && empty( $camera_settings['dual_enabled'] ) ) ) {
				return $this->error( 'incident_camera_consent_required', __( 'Camera privacy consent changed before this segment could be secured.', 'avenra-halo-v2' ), 403 );
			}
			if ( ! $this->incident_can_accept_upload( $incident ) ) {
				return $this->inactive_upload_response( $incident );
			}
			$current_grant = $this->grant_by_id( (int) $grant['grant']->id );
			if ( ! $current_grant || 'active' !== (string) $current_grant->status || strtotime( (string) $current_grant->expires_at . ' UTC' ) < time() ) {
				return $this->error( 'incident_media_grant_expired', __( 'The secure evidence grant has expired.', 'avenra-halo-v2' ), 401 );
			}
			$existing = $wpdb->get_row(
				$wpdb->prepare(
					"SELECT * FROM `" . esc_sql( $this->media_table() ) . "` WHERE incident_id = %d AND camera_role = %s AND segment_index = %d LIMIT 1",
					(int) $incident->id,
					$camera,
					$index
				)
			); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( is_object( $existing ) ) {
				if ( 'ready' === (string) $existing->upload_status && hash_equals( (string) $existing->sha256, $checksum ) ) {
					return $this->success( array( 'segment' => $this->serialise_media( $existing ), 'idempotent' => true ) );
				}
				return $this->error( 'incident_media_segment_conflict', __( 'A different segment already occupies this evidence position.', 'avenra-halo-v2' ), 409 );
			}
			$usage = $wpdb->get_row(
				$wpdb->prepare(
					"SELECT COUNT(*) AS segment_count, COALESCE(SUM(file_size),0) AS total_bytes, COALESCE(SUM(CASE WHEN camera_role = %s THEN duration_ms ELSE 0 END),0) AS camera_duration FROM `" . esc_sql( $this->media_table() ) . "` WHERE incident_id = %d AND upload_status = 'ready'",
					$camera,
					(int) $incident->id
				)
			); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( is_object( $usage ) && (int) $usage->segment_count >= 2 * self::MAX_SEGMENTS_PER_CAMERA ) {
				return $this->error( 'incident_media_segment_limit', __( 'The incident evidence segment limit has been reached.', 'avenra-halo-v2' ), 409 );
			}
			if ( is_object( $usage ) && (int) $usage->total_bytes + $file_size > $this->max_incident_bytes() ) {
				return $this->error( 'incident_media_incident_too_large', __( 'The incident evidence storage limit has been reached.', 'avenra-halo-v2' ), 413 );
			}
			if ( is_object( $usage ) && (int) $usage->camera_duration + $duration_ms > self::MAX_TOTAL_DURATION_MS ) {
				return $this->error( 'incident_media_duration_limit', __( 'Only the final sixty seconds from each camera may be retained.', 'avenra-halo-v2' ), 422 );
			}
			$root = $this->ensure_storage_root();
			if ( ! $root ) {
				return $this->error( 'incident_media_storage_unavailable', __( 'Secure incident storage is unavailable.', 'avenra-halo-v2' ), 503 );
			}
			$folder = substr( hash_hmac( 'sha256', 'incident|' . (string) $incident->public_id, wp_salt( 'secure_auth' ) ), 0, 32 );
			$directory = trailingslashit( $root ) . $folder;
			if ( ! wp_mkdir_p( $directory ) ) {
				return $this->error( 'incident_media_storage_unavailable', __( 'Secure incident storage is unavailable.', 'avenra-halo-v2' ), 503 );
			}
			@chmod( $directory, 0700 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod
			$public_id   = wp_generate_uuid4();
			$filename    = str_replace( '-', '', $public_id ) . '.' . $type['extension'];
			$storage_key = $folder . '/' . $filename;
			$target      = trailingslashit( $directory ) . $filename;
			$partial     = $target . '.part';
			if ( ! move_uploaded_file( (string) $file['tmp_name'], $partial ) ) {
				return $this->error( 'incident_media_store_failed', __( 'The evidence segment could not be secured.', 'avenra-halo-v2' ), 500 );
			}
			@chmod( $partial, 0600 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod
			if ( ! @rename( $partial, $target ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.rename_rename
				@unlink( $partial ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
				return $this->error( 'incident_media_store_failed', __( 'The evidence segment could not be secured.', 'avenra-halo-v2' ), 500 );
			}
			@chmod( $target, 0600 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod
			$now          = current_time( 'mysql', true );
			$retain_until = gmdate( 'Y-m-d H:i:s', time() + $this->retention_days() * DAY_IN_SECONDS );
			$captured_at  = $this->mysql_datetime( (string) ( $params['captured_at'] ?? $params['recorded_at'] ?? '' ) );
			$inserted     = $wpdb->insert(
				$this->media_table(),
				array(
					'public_id'            => $public_id,
					'incident_id'          => (int) $incident->id,
					'customer_id'          => (int) $incident->customer_id,
					'grant_id'             => (int) $current_grant->id,
					'camera_role'          => $camera,
					'segment_index'        => $index,
					'client_segment_id'    => '' !== $client_segment_id ? $client_segment_id : null,
					'storage_key'          => $storage_key,
					'mime_type'            => $type['mime_type'],
					'container'            => $type['container'],
					'file_size'            => $file_size,
					'sha256'               => $checksum,
					'duration_ms'           => $duration_ms,
					'captured_at'           => $captured_at,
					'upload_status'         => 'ready',
					'verification_status'   => $verification,
					'retain_until'          => $retain_until,
					'created_at'            => $now,
					'updated_at'            => $now,
				)
			);
			if ( false === $inserted ) {
				@unlink( $target ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
				return $this->error( 'incident_media_index_failed', __( 'The evidence segment could not be indexed securely.', 'avenra-halo-v2' ), 500 );
			}
			$media_id = (int) $wpdb->insert_id;
			// Defence in depth for any incident-state writer that does not yet share
			// the upload lock. Never leave a just-inserted segment behind once the
			// incident is no longer active/acknowledged.
			$current_incident = $this->incident_by_id( (int) $incident->id );
			if ( ! $this->incident_can_accept_upload( $current_incident ) ) {
				$discarded = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->media_table() ) . "` WHERE id = %d LIMIT 1", $media_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				if ( is_object( $discarded ) ) {
					$this->delete_media_row( $discarded, 'incident_state_changed' );
				}
				$wpdb->update( $this->grants_table(), array( 'status' => 'revoked', 'revoked_at' => current_time( 'mysql', true ) ), array( 'id' => (int) $current_grant->id, 'status' => 'active' ) );
				$state = sanitize_key( (string) ( $current_incident->status ?? 'missing' ) );
				if ( in_array( $state, array( 'cancelled', 'false_alarm' ), true ) ) {
					return $this->error( 'incident_media_discarded', __( 'This event was cancelled, so its buffered footage was not retained.', 'avenra-halo-v2' ), 410 );
				}
				return $this->error( 'incident_media_incident_closed', __( 'This incident can no longer accept evidence uploads.', 'avenra-halo-v2' ), 409, array( 'incident_status' => $state ) );
			}
			$wpdb->update( $this->grants_table(), array( 'last_used_at' => $now ), array( 'id' => (int) $current_grant->id ) );
			Avenra_Halo_V2_Emergency::instance()->append_event(
				(int) $incident->id,
				'evidence_segment_stored',
				'rider',
				array( 'camera' => $camera, 'segment' => $index, 'bytes' => $file_size, 'duration_ms' => $duration_ms, 'media_id' => $public_id )
			);
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->media_table() ) . "` WHERE id = %d LIMIT 1", $media_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return $this->success( array( 'segment' => $this->serialise_media( $row ), 'idempotent' => false ), 201 );
		} finally {
			$this->db->release_advisory_lock( $lock );
			$this->db->release_advisory_lock( $consent_lock );
		}
	}

	public function finalize_upload( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$grant = $this->upload_grant_for_request( $request, false );
		if ( is_wp_error( $grant ) ) {
			return $this->error_from_wp_error( $grant );
		}
		if ( ! $this->incident_can_accept_upload( $grant['incident'] ) ) {
			return $this->inactive_upload_response( $grant['incident'] );
		}
		$params = $this->request_params( $request );
		$expected_front = isset( $params['expected_front'] ) && is_numeric( $params['expected_front'] ) ? (int) $params['expected_front'] : -1;
		$expected_rear  = isset( $params['expected_rear'] ) && is_numeric( $params['expected_rear'] ) ? (int) $params['expected_rear'] : -1;
		if ( $expected_front < 0 || $expected_front > self::MAX_SEGMENTS_PER_CAMERA || $expected_rear < 0 || $expected_rear > self::MAX_SEGMENTS_PER_CAMERA || 0 === $expected_front + $expected_rear ) {
			return $this->error( 'incident_media_expected_invalid', __( 'The final evidence segment counts are invalid.', 'avenra-halo-v2' ), 422 );
		}
		$counts = $this->media_counts( (int) $grant['incident']->id );
		if ( $counts['front'] !== $expected_front || $counts['rear'] !== $expected_rear ) {
			return $this->error( 'incident_media_upload_incomplete', __( 'Some incident evidence segments are still uploading.', 'avenra-halo-v2' ), 409, array( 'retryable' => true, 'expected' => array( 'front' => $expected_front, 'rear' => $expected_rear ), 'received' => $counts ) );
		}
		$now = current_time( 'mysql', true );
		$updated = $wpdb->update(
			$this->grants_table(),
			array( 'status' => 'complete', 'expected_front' => $expected_front, 'expected_rear' => $expected_rear, 'finalized_at' => $now, 'last_used_at' => $now ),
			array( 'id' => (int) $grant['grant']->id, 'status' => 'active' )
		);
		if ( 1 !== (int) $updated ) {
			return $this->error( 'incident_media_finalize_failed', __( 'Halo could not finalize the evidence upload.', 'avenra-halo-v2' ), 503 );
		}
		Avenra_Halo_V2_Emergency::instance()->append_event( (int) $grant['incident']->id, 'evidence_upload_complete', 'rider', array( 'front' => $expected_front, 'rear' => $expected_rear ) );
		return $this->success( $this->media_status_payload( $grant['incident'] ) );
	}

	public function rider_media_status( WP_REST_Request $request ): WP_REST_Response {
		$incident = $this->incident_by_event( $this->auth->customer_id(), (string) $request['event_id'] );
		if ( ! $incident ) {
			return $this->error( 'incident_media_incident_missing', __( 'That Emergency Assist event was not found.', 'avenra-halo-v2' ), 404 );
		}
		if ( in_array( (string) $incident->status, array( 'cancelled', 'false_alarm' ), true ) ) {
			$this->purge_incident( (int) $incident->id, (string) $incident->status );
		}
		return $this->success( $this->media_status_payload( $incident ) );
	}

	public function operator_media_list( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$incident = $this->incident_by_public_id( strtolower( sanitize_text_field( (string) $request['incident_id'] ) ) );
		if ( ! $this->incident_can_be_viewed( $incident ) ) {
			return new WP_Error( 'incident_media_unavailable', __( 'Incident evidence is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		$items = $this->media_for_incident( (int) $incident->id, 'operations', '' );
		$this->audit_operator( 'incident_media_listed', $incident, array( 'count' => count( $items ) ) );
		return $this->private_response( array( 'incident_id' => (string) $incident->public_id, 'status' => $this->media_status_payload( $incident ), 'items' => $items ) );
	}

	public function responder_media_list( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$incident = $this->incident_by_public_id( strtolower( sanitize_text_field( (string) $request['incident_id'] ) ) );
		if ( ! $this->incident_can_be_viewed( $incident ) ) {
			return new WP_Error( 'incident_media_unavailable', __( 'Incident evidence is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		$role  = $this->responder_role( $request );
		$items = $this->media_for_incident( (int) $incident->id, 'responders', $role );
		$this->audit_responder( 'evidence_media_listed', $incident, $role, array( 'count' => count( $items ) ) );
		return $this->private_response( array( 'incident_id' => (string) $incident->public_id, 'items' => $items ) );
	}

	public function operator_media_file( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		return $this->private_file_response( $request, 'operator' );
	}

	public function responder_media_file( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		return $this->private_file_response( $request, 'responder' );
	}

	private function private_file_response( WP_REST_Request $request, string $audience ): WP_REST_Response|WP_Error {
		$incident = $this->incident_by_public_id( strtolower( sanitize_text_field( (string) $request['incident_id'] ) ) );
		if ( ! $this->incident_can_be_viewed( $incident ) ) {
			return new WP_Error( 'incident_media_unavailable', __( 'Incident evidence is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		$row = $this->media_by_public_id( (string) $request['media_id'], (int) $incident->id );
		if ( ! $row || 'ready' !== (string) $row->upload_status || ! in_array( (string) $row->verification_status, array( 'container_verified', 'external_verified' ), true ) ) {
			return new WP_Error( 'incident_media_file_missing', __( 'That evidence segment is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		$retain_until = strtotime( (string) $row->retain_until . ' UTC' );
		if ( false === $retain_until || $retain_until <= time() ) {
			$this->delete_media_row( $row, 'retention_hard_cap' );
			return new WP_Error( 'incident_media_file_missing', __( 'That evidence segment is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		$path = $this->private_media_path( (string) $row->storage_key );
		if ( ! $path ) {
			return new WP_Error( 'incident_media_file_missing', __( 'That evidence segment is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		if ( 'operator' === $audience ) {
			$this->audit_operator( 'incident_media_accessed', $incident, array( 'media_id' => (string) $row->public_id, 'delivery' => (string) $request['delivery'] ) );
		} else {
			$this->audit_responder( 'evidence_media_accessed', $incident, $this->responder_role( $request ), array( 'media_id' => (string) $row->public_id, 'delivery' => (string) $request['delivery'] ) );
		}
		$filename = sprintf( 'halo-incident-%s-%02d.%s', (string) $row->camera_role, (int) $row->segment_index + 1, (string) $row->container );
		return new WP_REST_Response(
			array(
				// Reuse the established private-file marker so the central REST
				// normaliser leaves this binary response untouched. Our priority-8
				// serving filter handles ranges before the document filter at 10.
				'_halo_private_file'         => $path,
				'_halo_incident_media'       => true,
				'mime_type'                 => (string) $row->mime_type,
				'filename'                  => $filename,
				'disposition'               => 'download' === (string) $request['delivery'] ? 'attachment' : 'inline',
				'etag'                      => (string) $row->sha256,
			),
			200
		);
	}

	/** Stream a protected file and implement a single RFC 7233 byte range. */
	public function serve_private_media( bool $served, WP_HTTP_Response $result, WP_REST_Request $request, WP_REST_Server $server ): bool {
		if ( $served ) {
			return true;
		}
		$data = $result->get_data();
		if ( ! is_array( $data ) || empty( $data['_halo_incident_media'] ) || empty( $data['_halo_private_file'] ) || ! is_file( (string) $data['_halo_private_file'] ) ) {
			return false;
		}
		$path = (string) $data['_halo_private_file'];
		$size = filesize( $path );
		if ( false === $size || $size < 1 ) {
			status_header( 404 );
			return true;
		}
		$start = 0;
		$end   = $size - 1;
		$status = 200;
		$range = trim( (string) $request->get_header( 'Range' ) );
		if ( '' !== $range ) {
			$parsed = $this->parse_byte_range( $range, $size );
			if ( ! $parsed ) {
				status_header( 416 );
				nocache_headers();
				header( 'Content-Range: bytes */' . $size );
				header( 'X-Content-Type-Options: nosniff' );
				return true;
			}
			$start  = $parsed[0];
			$end    = $parsed[1];
			$status = 206;
		}
		$length      = $end - $start + 1;
		$filename    = sanitize_file_name( (string) ( $data['filename'] ?? basename( $path ) ) );
		$mime        = sanitize_mime_type( (string) ( $data['mime_type'] ?? 'application/octet-stream' ) );
		$disposition = 'attachment' === (string) ( $data['disposition'] ?? '' ) ? 'attachment' : 'inline';
		status_header( $status );
		nocache_headers();
		header( 'Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0', true );
		header( 'CDN-Cache-Control: no-store', true );
		header( 'Cloudflare-CDN-Cache-Control: no-store', true );
		header( 'Content-Type: ' . ( $mime ?: 'application/octet-stream' ) );
		if ( ! empty( $data['etag'] ) && preg_match( '/^[a-f0-9]{64}$/', (string) $data['etag'] ) ) {
			header( 'ETag: "' . (string) $data['etag'] . '"' );
		}
		header( 'Accept-Ranges: bytes' );
		header( 'Content-Length: ' . $length );
		if ( 206 === $status ) {
			header( 'Content-Range: bytes ' . $start . '-' . $end . '/' . $size );
		}
		header( 'Content-Disposition: ' . $disposition . '; filename="' . str_replace( '"', '', $filename ) . '"' );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'X-Accel-Buffering: no' );
		header( 'Cross-Origin-Resource-Policy: same-origin' );
		header( 'Referrer-Policy: no-referrer' );
		if ( 'HEAD' === strtoupper( $request->get_method() ) ) {
			return true;
		}
		$handle = @fopen( $path, 'rb' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		if ( false === $handle ) {
			return true;
		}
		@fseek( $handle, $start ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_fseek
		$remaining = $length;
		while ( $remaining > 0 && ! feof( $handle ) && ! connection_aborted() ) {
			$chunk = fread( $handle, min( 1024 * 1024, $remaining ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fread
			if ( false === $chunk || '' === $chunk ) {
				break;
			}
			echo $chunk; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- binary response.
			$remaining -= strlen( $chunk );
			flush();
		}
		fclose( $handle ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		return true;
	}

	/** Delete expired evidence and any evidence attached to a false/cancelled event. */
	public function cleanup(): void {
		global $wpdb;
		if ( ! $this->storage_ready() ) {
			return;
		}
		$this->purge_invalid_incidents( 100 );
		$now    = current_time( 'mysql', true );
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - $this->retention_days() * DAY_IN_SECONDS );
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT m.* FROM `" . esc_sql( $this->media_table() ) . "` m LEFT JOIN `" . esc_sql( $this->db->table( 'incidents' ) ) . "` i ON i.id = m.incident_id WHERE m.upload_status = 'ready' AND (m.retain_until <= %s OR m.verification_status NOT IN ('container_verified','external_verified') OR i.id IS NULL OR (i.status NOT IN ('active','acknowledged') AND COALESCE(i.resolved_at,m.created_at) < %s)) ORDER BY m.id ASC LIMIT 250",
				$now,
				$cutoff
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		foreach ( $rows as $row ) {
			$reason = (string) $row->retain_until <= $now ? 'retention_hard_cap' : ( in_array( (string) $row->verification_status, array( 'container_verified', 'external_verified' ), true ) ? 'retention_expired' : 'container_unverified' );
			$this->delete_media_row( $row, $reason );
		}
		$wpdb->query( $wpdb->prepare( "UPDATE `" . esc_sql( $this->grants_table() ) . "` SET status = 'expired', revoked_at = %s WHERE status = 'active' AND expires_at < %s", $now, $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$grant_cutoff = gmdate( 'Y-m-d H:i:s', time() - ( $this->retention_days() + 7 ) * DAY_IN_SECONDS );
		$wpdb->query( $wpdb->prepare( "DELETE FROM `" . esc_sql( $this->grants_table() ) . "` WHERE expires_at < %s", $grant_cutoff ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	/** Same-request privacy cleanup after a cancellation/false-alarm mutation. */
	public function shutdown_purge_invalid_incidents(): void {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false === strpos( $uri, '/avenra-halo/v2/' ) && false === strpos( $uri, '/halo-assist' ) && false === strpos( $uri, '/halo-emergency-assist' ) ) {
			return;
		}
		$this->purge_invalid_incidents( 20 );
	}

	public function purge_invalid_incidents( int $limit = 20 ): void {
		global $wpdb;
		if ( ! $this->storage_ready() ) {
			return;
		}
		$now = current_time( 'mysql', true );
		$wpdb->query(
			$wpdb->prepare(
				"UPDATE `" . esc_sql( $this->grants_table() ) . "` g INNER JOIN `" . esc_sql( $this->db->table( 'incidents' ) ) . "` i ON i.id = g.incident_id SET g.status = 'revoked', g.revoked_at = %s WHERE g.status IN ('active','complete') AND i.status IN ('cancelled','false_alarm')",
				$now
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$limit = min( 250, max( 1, $limit ) );
		$ids = $wpdb->get_col(
			"SELECT DISTINCT m.incident_id FROM `" . esc_sql( $this->media_table() ) . "` m INNER JOIN `" . esc_sql( $this->db->table( 'incidents' ) ) . "` i ON i.id = m.incident_id WHERE m.upload_status = 'ready' AND i.status IN ('cancelled','false_alarm') ORDER BY m.incident_id ASC LIMIT " . (int) $limit // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		);
		foreach ( $ids as $incident_id ) {
			$status = (string) $wpdb->get_var( $wpdb->prepare( "SELECT status FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE id = %d LIMIT 1", (int) $incident_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$this->purge_incident( (int) $incident_id, in_array( $status, array( 'cancelled', 'false_alarm' ), true ) ? $status : 'invalid' );
		}
	}

	/** Public integration point for an immediate incident state-transition purge. */
	public function purge_incident( int $incident_id, string $reason = 'privacy_state' ): void {
		if ( $incident_id < 1 || ! $this->storage_ready() ) {
			return;
		}
		$lock = $this->db->acquire_advisory_lock( 'incident-media-upload', (string) $incident_id, 1 );
		if ( ! $lock ) {
			return;
		}
		try {
			$this->purge_incident_rows( $incident_id, $reason );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	/**
	 * State-transition integration point. The caller must already hold the
	 * incident-media-upload lock for this incident.
	 */
	public function purge_incident_under_upload_lock( int $incident_id, string $reason ): void {
		if ( $incident_id < 1 || ! $this->storage_ready() ) {
			return;
		}
		$this->purge_incident_rows( $incident_id, $reason );
	}

	private function purge_incident_rows( int $incident_id, string $reason ): void {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->media_table() ) . "` WHERE incident_id = %d AND upload_status = 'ready'", $incident_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		foreach ( $rows as $row ) {
			$this->delete_media_row( $row, sanitize_key( $reason ) ?: 'privacy_state' );
		}
		$now = current_time( 'mysql', true );
		$wpdb->query( $wpdb->prepare( "UPDATE `" . esc_sql( $this->grants_table() ) . "` SET status = 'revoked', revoked_at = %s WHERE incident_id = %d AND status IN ('active','complete')", $now, $incident_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( $rows ) {
			Avenra_Halo_V2_Emergency::instance()->append_event( $incident_id, 'evidence_media_deleted', 'system', array( 'reason' => sanitize_key( $reason ), 'segments' => count( $rows ) ) );
		}
	}

	/** @return array{grant:object,incident:object}|WP_Error */
	private function upload_grant_for_request( WP_REST_Request $request, bool $allow_complete ) {
		global $wpdb;
		$token = trim( (string) $request->get_header( 'X-Halo-Media-Token' ) );
		if ( ! preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $token ) ) {
			return new WP_Error( 'incident_media_grant_required', __( 'A secure evidence upload grant is required.', 'avenra-halo-v2' ), array( 'status' => 401 ) );
		}
		$session = $this->auth->session();
		if ( ! $session ) {
			return new WP_Error( 'incident_media_session_unavailable', __( 'Sign in to Halo again before uploading evidence.', 'avenra-halo-v2' ), array( 'status' => 401 ) );
		}
		$event_id = sanitize_text_field( (string) $request['event_id'] );
		$row = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT g.* FROM `" . esc_sql( $this->grants_table() ) . "` g INNER JOIN `" . esc_sql( $this->db->table( 'incidents' ) ) . "` i ON i.id = g.incident_id WHERE g.token_hash = %s AND g.customer_id = %d AND g.session_id = %d AND i.customer_id = %d AND i.client_event_id = %s LIMIT 1",
				$this->token_hash( $token ),
				$this->auth->customer_id(),
				(int) $session->id,
				$this->auth->customer_id(),
				$event_id
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$allowed_status = $allow_complete ? array( 'active', 'complete' ) : array( 'active' );
		if ( ! is_object( $row ) || ! in_array( (string) $row->status, $allowed_status, true ) || strtotime( (string) $row->expires_at . ' UTC' ) < time() ) {
			return new WP_Error( 'incident_media_grant_expired', __( 'The secure evidence upload grant has expired.', 'avenra-halo-v2' ), array( 'status' => 401 ) );
		}
		$incident = $this->incident_by_id( (int) $row->incident_id );
		if ( ! $incident ) {
			return new WP_Error( 'incident_media_incident_missing', __( 'That Emergency Assist event was not found.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		return array( 'grant' => $row, 'incident' => $incident );
	}

	private function inactive_upload_response( ?object $incident ): WP_REST_Response {
		$status = $incident ? sanitize_key( (string) $incident->status ) : 'missing';
		if ( in_array( $status, array( 'cancelled', 'false_alarm' ), true ) && $incident ) {
			$this->purge_incident( (int) $incident->id, $status );
			return $this->error( 'incident_media_discarded', __( 'This event was cancelled, so its buffered footage was not retained.', 'avenra-halo-v2' ), 410 );
		}
		if ( 'candidate' === $status ) {
			return $this->error( 'incident_media_waiting_for_activation', __( 'The incident is still inside the rider cancellation window. Keep the footage on this device and retry after activation.', 'avenra-halo-v2' ), 409, array( 'retryable' => true, 'incident_status' => $status ) );
		}
		return $this->error( 'incident_media_incident_closed', __( 'This incident can no longer accept evidence uploads.', 'avenra-halo-v2' ), 409, array( 'incident_status' => $status ) );
	}

	private function incident_can_accept_upload( ?object $incident ): bool {
		return $incident
			&& '1' !== (string) ( $incident->is_test ?? '0' )
			&& ! empty( $incident->activated_at )
			&& in_array( (string) $incident->status, array( 'active', 'acknowledged' ), true );
	}

	private function incident_can_be_viewed( ?object $incident ): bool {
		return $incident
			&& '1' !== (string) ( $incident->is_test ?? '0' )
			&& ! empty( $incident->activated_at )
			&& in_array( (string) $incident->status, array( 'active', 'acknowledged', 'resolved' ), true );
	}

	/** @return array<string,mixed> */
	private function media_status_payload( object $incident ): array {
		global $wpdb;
		$counts = $this->media_counts( (int) $incident->id );
		$grant = $wpdb->get_row( $wpdb->prepare( "SELECT status, expected_front, expected_rear, finalized_at, expires_at FROM `" . esc_sql( $this->grants_table() ) . "` WHERE incident_id = %d ORDER BY id DESC LIMIT 1", (int) $incident->id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return array(
			'incident_status' => sanitize_key( (string) $incident->status ),
			'upload_status'   => is_object( $grant ) ? sanitize_key( (string) $grant->status ) : 'not_started',
			'received'        => $counts,
			'expected'        => is_object( $grant ) ? array( 'front' => (int) $grant->expected_front, 'rear' => (int) $grant->expected_rear ) : array( 'front' => 0, 'rear' => 0 ),
			'finalized_at'    => is_object( $grant ) ? $this->rfc3339( $grant->finalized_at ?? null ) : null,
			'expires_at'      => is_object( $grant ) ? $this->rfc3339( $grant->expires_at ?? null ) : null,
		);
	}

	/** @return array{front:int,rear:int,total:int} */
	private function media_counts( int $incident_id ): array {
		global $wpdb;
		$now = current_time( 'mysql', true );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT camera_role, COUNT(*) AS segment_count FROM `" . esc_sql( $this->media_table() ) . "` WHERE incident_id = %d AND upload_status = 'ready' AND verification_status IN ('container_verified','external_verified') AND retain_until > %s GROUP BY camera_role", $incident_id, $now ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$counts = array( 'front' => 0, 'rear' => 0, 'total' => 0 );
		foreach ( $rows as $row ) {
			$role = sanitize_key( (string) $row['camera_role'] );
			if ( isset( $counts[ $role ] ) ) {
				$counts[ $role ] = (int) $row['segment_count'];
			}
		}
		$counts['total'] = $counts['front'] + $counts['rear'];
		return $counts;
	}

	/** @return array<int,array<string,mixed>> */
	private function media_for_incident( int $incident_id, string $audience, string $role ): array {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->media_table() ) . "` WHERE incident_id = %d AND upload_status = 'ready' AND verification_status IN ('container_verified','external_verified') AND retain_until > %s ORDER BY camera_role DESC, segment_index ASC", $incident_id, current_time( 'mysql', true ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$items = array();
		foreach ( $rows as $row ) {
			$item = $this->serialise_media( $row );
			$base = rest_url( self::NS . '/' . $audience . '/incidents/' . rawurlencode( (string) $this->incident_public_id( $incident_id ) ) . '/media/' . rawurlencode( (string) $row->public_id ) );
			$query = 'responders' === $audience ? array( 'role' => $role ) : array();
			$item['stream_url']   = add_query_arg( $query, $base . '/stream' );
			$item['download_url'] = add_query_arg( $query, $base . '/download' );
			$items[] = $item;
		}
		return $items;
	}

	/** @return array<string,mixed> */
	private function serialise_media( ?object $row ): array {
		if ( ! $row ) {
			return array();
		}
		return array(
			'id'                  => sanitize_text_field( (string) $row->public_id ),
			'camera_role'         => sanitize_key( (string) $row->camera_role ),
			'segment_index'       => (int) $row->segment_index,
			'duration_ms'         => (int) $row->duration_ms,
			'mime_type'           => sanitize_mime_type( (string) $row->mime_type ),
			'file_size'           => (int) $row->file_size,
			'upload_status'       => sanitize_key( (string) $row->upload_status ),
			'verification_status' => sanitize_key( (string) $row->verification_status ),
			'captured_at'         => $this->rfc3339( $row->captured_at ?? null ),
			'created_at'          => $this->rfc3339( $row->created_at ?? null ),
		);
	}

	/** @return array{mime_type:string,container:string,extension:string}|WP_Error */
	private function inspect_video_type( string $path, string $filename, string $declared_type ) {
		$handle = @fopen( $path, 'rb' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		$header = false !== $handle ? fread( $handle, 16 ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fread
		if ( false !== $handle ) {
			fclose( $handle ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		}
		if ( ! is_string( $header ) || strlen( $header ) < 8 ) {
			return new WP_Error( 'incident_media_type_invalid', __( 'The evidence segment is not a supported video file.', 'avenra-halo-v2' ), array( 'status' => 415 ) );
		}
		$is_webm = str_starts_with( $header, "\x1A\x45\xDF\xA3" );
		$is_mp4  = 'ftyp' === substr( $header, 4, 4 );
		$declared_type = strtolower( trim( explode( ';', $declared_type )[0] ) );
		$extension = strtolower( pathinfo( sanitize_file_name( $filename ), PATHINFO_EXTENSION ) );
		$detected_type = '';
		if ( class_exists( 'finfo' ) ) {
			try {
				$finfo = new finfo( FILEINFO_MIME_TYPE );
				$detected_type = strtolower( trim( (string) $finfo->file( $path ) ) );
			} catch ( Throwable $error ) {
				$detected_type = '';
			}
		}
		if ( $is_webm && in_array( $extension, array( 'webm', '' ), true ) && in_array( $declared_type, array( 'video/webm', 'application/octet-stream', '' ), true ) ) {
			if ( ! in_array( $detected_type, array( '', 'video/webm', 'video/x-matroska', 'application/x-matroska', 'application/octet-stream' ), true ) ) {
				return new WP_Error( 'incident_media_type_invalid', __( 'The evidence segment MIME type did not match WebM video.', 'avenra-halo-v2' ), array( 'status' => 415 ) );
			}
			return array( 'mime_type' => 'video/webm', 'container' => 'webm', 'extension' => 'webm' );
		}
		if ( $is_mp4 && in_array( $extension, array( 'mp4', 'm4v', '' ), true ) && in_array( $declared_type, array( 'video/mp4', 'application/mp4', 'application/octet-stream', '' ), true ) ) {
			if ( ! in_array( $detected_type, array( '', 'video/mp4', 'application/mp4', 'application/octet-stream' ), true ) ) {
				return new WP_Error( 'incident_media_type_invalid', __( 'The evidence segment MIME type did not match MP4 video.', 'avenra-halo-v2' ), array( 'status' => 415 ) );
			}
			return array( 'mime_type' => 'video/mp4', 'container' => 'mp4', 'extension' => 'mp4' );
		}
		return new WP_Error( 'incident_media_type_invalid', __( 'Upload an MP4 or WebM evidence segment.', 'avenra-halo-v2' ), array( 'status' => 415 ) );
	}

	/**
	 * A magic signature is only a preflight. A segment becomes playable evidence
	 * only after WordPress' media analyser confirms a real video container and
	 * codec, or an explicitly installed verifier filter does so.
	 *
	 * @param array{mime_type:string,container:string,extension:string} $type
	 * @return array{verification_status:string,duration_ms:int}|WP_Error
	 */
	private function verify_video_segment( string $path, array $type, int $declared_duration_ms, int $file_size, string $camera, object $incident ): array|WP_Error {
		$core = $this->read_actual_video_metadata( $path );
		$expected_container = (string) $type['container'];
		$core_container_ok = is_array( $core ) && in_array(
			(string) $core['container'],
			'mp4' === $expected_container ? array( 'mp4', 'quicktime', 'mov', 'isom' ) : array( 'webm', 'matroska' ),
			true
		);
		$core_verified = $core_container_ok && '' !== (string) ( $core['codec'] ?? '' ) && (int) ( $core['duration_ms'] ?? 0 ) > 0;
		$metadata = array(
			'mime_type'        => $type['mime_type'],
			'container'        => $expected_container,
			'file_size'        => $file_size,
			'duration_ms'      => $declared_duration_ms,
			'camera_role'      => $camera,
			'analyser'         => is_array( $core ) ? 'wp_read_video_metadata' : 'unavailable',
			'analyser_format'  => is_array( $core ) ? (string) $core['container'] : '',
			'analyser_codec'   => is_array( $core ) ? (string) $core['codec'] : '',
			'analyser_duration_ms' => is_array( $core ) ? (int) $core['duration_ms'] : 0,
		);
		// Default null is deliberate: metadata/magic-only files fail closed unless
		// a real verifier has explicitly opted in and confirmed the container.
		$external = apply_filters( 'avenra_halo_v2_incident_media_validate_segment', null, $path, $metadata, $incident );
		if ( is_wp_error( $external ) ) {
			return $external;
		}
		if ( false === $external ) {
			return new WP_Error( 'incident_media_validation_failed', __( 'The evidence segment did not pass secure validation.', 'avenra-halo-v2' ), array( 'status' => 415 ) );
		}

		$external_verified = true === $external;
		$verified_duration = is_array( $core ) && (int) $core['duration_ms'] > 0 ? (int) $core['duration_ms'] : null;
		if ( is_array( $external ) && true === ( $external['verified'] ?? false ) ) {
			$external_container = sanitize_key( (string) ( $external['container'] ?? '' ) );
			$external_codec     = trim( sanitize_text_field( (string) ( $external['codec'] ?? '' ) ) );
			$external_verified  = $expected_container === $external_container && '' !== $external_codec;
			if ( $external_verified && isset( $external['duration_ms'] ) && is_numeric( $external['duration_ms'] ) ) {
				$verified_duration = (int) round( (float) $external['duration_ms'] );
			}
		}
		if ( ! $core_verified && ! $external_verified ) {
			return new WP_Error( 'incident_media_container_unverified', __( 'The evidence segment could not be verified as a playable video container.', 'avenra-halo-v2' ), array( 'status' => 415 ) );
		}
		if ( null !== $verified_duration ) {
			$tolerance = max( 2500, (int) round( $declared_duration_ms * 0.30 ) );
			if ( $verified_duration < 100 || $verified_duration > self::MAX_ACCEPTED_DURATION_MS || abs( $verified_duration - $declared_duration_ms ) > $tolerance ) {
				return new WP_Error( 'incident_media_duration_mismatch', __( 'The recorded segment duration does not match its evidence metadata.', 'avenra-halo-v2' ), array( 'status' => 422 ) );
			}
		}
		return array(
			'verification_status' => $core_verified ? 'container_verified' : 'external_verified',
			'duration_ms'         => null !== $verified_duration ? $verified_duration : $declared_duration_ms,
		);
	}

	/** @return array{duration_ms:int,container:string,codec:string}|null */
	private function read_actual_video_metadata( string $path ): ?array {
		if ( ! function_exists( 'wp_read_video_metadata' ) ) {
			$include = ABSPATH . 'wp-admin/includes/media.php';
			if ( is_file( $include ) ) {
				require_once $include;
			}
		}
		if ( ! function_exists( 'wp_read_video_metadata' ) ) {
			return null;
		}
		try {
			$metadata = wp_read_video_metadata( $path );
			if ( ! is_array( $metadata ) ) {
				return null;
			}
			$seconds   = isset( $metadata['length'] ) && is_numeric( $metadata['length'] ) ? (float) $metadata['length'] : 0.0;
			$container = sanitize_key( (string) ( $metadata['fileformat'] ?? $metadata['container'] ?? '' ) );
			$codec     = (string) ( $metadata['video_codec'] ?? $metadata['codec'] ?? $metadata['dataformat'] ?? '' );
			if ( '' === $codec && isset( $metadata['video'] ) && is_array( $metadata['video'] ) ) {
				$codec = (string) ( $metadata['video']['codec'] ?? $metadata['video']['dataformat'] ?? '' );
			}
			$codec = substr( trim( sanitize_text_field( $codec ) ), 0, 80 );
			if ( $seconds <= 0 || '' === $container || '' === $codec ) {
				return null;
			}
			return array( 'duration_ms' => (int) round( $seconds * 1000 ), 'container' => $container, 'codec' => $codec );
		} catch ( Throwable $error ) {
			return null;
		}
	}

	/** @return array{0:int,1:int}|null */
	private function parse_byte_range( string $range, int $size ): ?array {
		if ( ! preg_match( '/^bytes=(\d*)-(\d*)$/', trim( $range ), $matches ) || ( '' === $matches[1] && '' === $matches[2] ) ) {
			return null;
		}
		if ( '' === $matches[1] ) {
			$suffix = (int) $matches[2];
			if ( $suffix < 1 ) {
				return null;
			}
			return array( max( 0, $size - $suffix ), $size - 1 );
		}
		$start = (int) $matches[1];
		$end   = '' === $matches[2] ? $size - 1 : (int) $matches[2];
		if ( $start >= $size || $start > $end ) {
			return null;
		}
		return array( $start, min( $size - 1, $end ) );
	}

	private function delete_media_row( object $row, string $reason ): void {
		global $wpdb;
		$path = $this->private_media_path( (string) $row->storage_key );
		if ( $path ) {
			@unlink( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
			@rmdir( dirname( $path ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
		}
		$now = current_time( 'mysql', true );
		$wpdb->update(
			$this->media_table(),
			array( 'storage_key' => '', 'sha256' => '', 'upload_status' => 'deleted', 'upload_error_code' => substr( sanitize_key( $reason ), 0, 48 ), 'deleted_at' => $now, 'updated_at' => $now ),
			array( 'id' => (int) $row->id, 'upload_status' => 'ready' )
		);
	}

	/** @return object|null */
	private function incident_by_event( int $customer_id, string $event_id ): ?object {
		global $wpdb;
		if ( $customer_id < 1 || ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $event_id ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE customer_id = %d AND client_event_id = %s LIMIT 1", $customer_id, $event_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function incident_by_id( int $incident_id ): ?object {
		global $wpdb;
		$row = $incident_id > 0 ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE id = %d LIMIT 1", $incident_id ) ) : null; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function incident_by_public_id( string $public_id ): ?object {
		global $wpdb;
		if ( ! preg_match( '/^[a-fA-F0-9-]{36}$/', $public_id ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE public_id = %s LIMIT 1", $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function media_by_public_id( string $public_id, int $incident_id ): ?object {
		global $wpdb;
		if ( ! preg_match( '/^[a-fA-F0-9-]{36}$/', $public_id ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->media_table() ) . "` WHERE public_id = %s AND incident_id = %d LIMIT 1", $public_id, $incident_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function grant_by_id( int $grant_id ): ?object {
		global $wpdb;
		$row = $grant_id > 0 ? $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->grants_table() ) . "` WHERE id = %d LIMIT 1", $grant_id ) ) : null; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function incident_public_id( int $incident_id ): string {
		global $wpdb;
		return sanitize_text_field( (string) $wpdb->get_var( $wpdb->prepare( "SELECT public_id FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE id = %d LIMIT 1", $incident_id ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	private function private_media_path( string $storage_key ): ?string {
		if ( ! preg_match( '#^[a-f0-9]{32}/[a-f0-9]{32}\.(?:webm|mp4)$#', $storage_key ) ) {
			return null;
		}
		$root = $this->ensure_storage_root();
		if ( ! $root ) {
			return null;
		}
		$path = realpath( trailingslashit( $root ) . $storage_key );
		$real_root = realpath( $root );
		if ( false === $path || false === $real_root || ! str_starts_with( $path, trailingslashit( $real_root ) ) || ! is_file( $path ) ) {
			return null;
		}
		return $path;
	}

	/** Prefer storage outside the web root; public-tree fallback is opt-in only. */
	private function ensure_storage_root(): ?string {
		if ( null !== $this->storage_root ) {
			return $this->storage_root;
		}
		$candidates = array();
		if ( defined( 'AVENRA_HALO_V2_PRIVATE_STORAGE_DIR' ) && is_string( AVENRA_HALO_V2_PRIVATE_STORAGE_DIR ) ) {
			$candidates[] = untrailingslashit( AVENRA_HALO_V2_PRIVATE_STORAGE_DIR ) . '/incident-media';
		}
		$filtered = apply_filters( 'avenra_halo_v2_incident_media_storage_root', '' );
		if ( is_string( $filtered ) && '' !== trim( $filtered ) ) {
			$filtered_base = untrailingslashit( trim( $filtered ) );
			// A filter selects a private base, never the purge target itself. Keep a
			// dedicated component child even when an administrator supplies a broad
			// custom path by mistake.
			if ( 'incident-media' !== basename( $filtered_base ) ) {
				$filtered_base .= '/incident-media';
			}
			array_unshift( $candidates, $filtered_base );
		}
		$candidates[] = trailingslashit( dirname( untrailingslashit( ABSPATH ) ) ) . 'avenra-halo-private/incident-media';
		if ( (bool) apply_filters( 'avenra_halo_v2_incident_media_allow_webroot_storage', false ) ) {
			// Apache/IIS deny files are installed below, but Nginx must also deny
			// this path at server level before this fallback is enabled.
			$candidates[] = trailingslashit( WP_CONTENT_DIR ) . 'avenra-halo-private/incident-media';
		}
		// Every WordPress installation receives a deterministic, non-secret scope,
		// including single-site installs. Shared custom/default base directories can
		// therefore never make one installation the owner of another one's files.
		$scope_suffix = '/site-' . get_current_blog_id() . '-' . $this->storage_scope_hash();
		foreach ( array_unique( $candidates ) as $candidate ) {
			$directory = untrailingslashit( $candidate ) . $scope_suffix;
			if ( ! is_dir( $directory ) && ! wp_mkdir_p( $directory ) ) {
				continue;
			}
			@chmod( $directory, 0700 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod
			if ( ! is_writable( $directory ) ) {
				continue;
			}
			if ( ! $this->protect_storage_directory( $directory ) ) {
				continue;
			}
			$real = realpath( $directory );
			if ( false !== $real ) {
				$this->storage_root = $real;
				update_option( 'avenra_halo_v2_incident_media_storage_root', $real, false );
				return $real;
			}
		}
		return null;
	}

	private function protect_storage_directory( string $directory ): bool {
		$marker_contents = 'avenra-halo-v2-incident-media:' . $this->storage_scope_hash() . "\n";
		$marker_path     = trailingslashit( $directory ) . '.avenra-halo-v2-incident-media';
		if ( is_file( $marker_path ) && trim( (string) file_get_contents( $marker_path ) ) !== trim( $marker_contents ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			return false;
		}
		@chmod( $directory, 0700 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod
		$files = array(
			'.avenra-halo-v2-incident-media' => $marker_contents,
			'.htaccess'                     => "Require all denied\nDeny from all\n",
			'web.config'                    => "<?xml version=\"1.0\" encoding=\"UTF-8\"?><configuration><system.webServer><authorization><deny users=\"*\" /></authorization></system.webServer></configuration>\n",
			'index.php'                     => "<?php\nhttp_response_code( 404 );\nexit;\n",
		);
		foreach ( $files as $name => $contents ) {
			$path = trailingslashit( $directory ) . $name;
			if ( ! file_exists( $path ) ) {
				if ( false === file_put_contents( $path, $contents, LOCK_EX ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
					return false;
				}
			}
			@chmod( $path, 0600 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod
		}
		return is_file( $marker_path ) && hash_equals( trim( $marker_contents ), trim( (string) file_get_contents( $marker_path ) ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
	}

	/** Stable and deliberately non-secret installation ownership identifier. */
	private function storage_scope_hash(): string {
		global $wpdb;
		$scope = strtolower( untrailingslashit( (string) home_url( '/' ) ) )
			. '|' . wp_normalize_path( untrailingslashit( ABSPATH ) )
			. '|' . (string) $wpdb->prefix
			. '|' . get_current_blog_id();
		return substr( hash( 'sha256', $scope ), 0, 16 );
	}

	private function storage_ready(): bool {
		return $this->db->table_exists( $this->grants_table() )
			&& $this->db->table_exists( $this->media_table() )
			&& $this->db->table_exists( $this->db->table( 'incidents' ) );
	}

	/** Main-schema fields that the incident-media installer does not own. */
	private function main_camera_schema_ready(): bool {
		$incidents = $this->db->table( 'incidents' );
		return $this->camera_settings_storage_ready()
			&& $this->db->table_exists( $incidents )
			&& $this->db->has_column( $incidents, 'client_ride_id' );
	}

	/** Verify every required column and ordered index before marking migration done. */
	private function schema_ready(): bool {
		if ( ! $this->storage_ready() || ! $this->db->has_column( $this->db->table( 'incidents' ), 'client_ride_id' ) ) {
			return false;
		}
		return $this->table_contract_ready(
			$this->grants_table(),
			array( 'id', 'incident_id', 'customer_id', 'session_id', 'client_ride_id', 'token_hash', 'status', 'expected_front', 'expected_rear', 'created_at', 'last_used_at', 'finalized_at', 'expires_at', 'revoked_at' ),
			array(
				'PRIMARY'          => array( true, array( 'id' ) ),
				'token_hash'       => array( true, array( 'token_hash' ) ),
				'incident_status'  => array( false, array( 'incident_id', 'status' ) ),
				'customer_session' => array( false, array( 'customer_id', 'session_id' ) ),
				'expires_at'       => array( false, array( 'expires_at' ) ),
			)
		) && $this->table_contract_ready(
			$this->media_table(),
			array( 'id', 'public_id', 'incident_id', 'customer_id', 'grant_id', 'camera_role', 'segment_index', 'client_segment_id', 'storage_key', 'mime_type', 'container', 'file_size', 'sha256', 'duration_ms', 'captured_at', 'upload_status', 'verification_status', 'upload_error_code', 'retain_until', 'created_at', 'updated_at', 'deleted_at' ),
			array(
				'PRIMARY'                 => array( true, array( 'id' ) ),
				'public_id'               => array( true, array( 'public_id' ) ),
				'incident_camera_segment' => array( true, array( 'incident_id', 'camera_role', 'segment_index' ) ),
				'incident_status'         => array( false, array( 'incident_id', 'upload_status' ) ),
				'customer_created'        => array( false, array( 'customer_id', 'created_at' ) ),
				'retain_until'            => array( false, array( 'retain_until' ) ),
			)
		);
	}

	/**
	 * @param array<int,string> $required_columns
	 * @param array<string,array{0:bool,1:array<int,string>}> $required_indexes
	 */
	private function table_contract_ready( string $table, array $required_columns, array $required_indexes ): bool {
		global $wpdb;
		$wpdb->last_error = '';
		$column_rows = $wpdb->get_results( 'SHOW COLUMNS FROM `' . esc_sql( $table ) . '`', ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( '' !== trim( (string) $wpdb->last_error ) || ! is_array( $column_rows ) ) {
			return false;
		}
		$columns = array_map( static fn( array $row ): string => (string) ( $row['Field'] ?? '' ), $column_rows );
		if ( array_diff( $required_columns, $columns ) ) {
			return false;
		}
		$wpdb->last_error = '';
		$index_rows = $wpdb->get_results( 'SHOW INDEX FROM `' . esc_sql( $table ) . '`', ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( '' !== trim( (string) $wpdb->last_error ) || ! is_array( $index_rows ) ) {
			return false;
		}
		$indexes = array();
		foreach ( $index_rows as $row ) {
			$name = (string) ( $row['Key_name'] ?? '' );
			$seq  = max( 1, (int) ( $row['Seq_in_index'] ?? 1 ) );
			$indexes[ $name ]['unique'] = 0 === (int) ( $row['Non_unique'] ?? 1 );
			$indexes[ $name ]['columns'][ $seq ] = (string) ( $row['Column_name'] ?? '' );
		}
		foreach ( $required_indexes as $name => $contract ) {
			if ( ! isset( $indexes[ $name ] ) || (bool) $indexes[ $name ]['unique'] !== $contract[0] ) {
				return false;
			}
			ksort( $indexes[ $name ]['columns'] );
			if ( array_values( $indexes[ $name ]['columns'] ) !== $contract[1] ) {
				return false;
			}
		}
		return true;
	}

	private function camera_settings_storage_ready(): bool {
		$table = $this->db->table( 'emergency_settings' );
		if ( ! $this->db->table_exists( $table ) ) {
			return false;
		}
		$required = array(
			'incident_camera_enabled',
			'incident_camera_dual_enabled',
			'incident_camera_consent_version',
			'incident_camera_consented_at',
			'incident_camera_revoked_at',
		);
		foreach ( $required as $column ) {
			if ( ! $this->db->has_column( $table, $column ) ) {
				return false;
			}
		}
		return true;
	}

	/** @return array{provider_ready:bool,storage_ready:bool,readiness_reason:?string,readiness_reasons:array<int,string>} */
	private function camera_backend_readiness(): array {
		$reasons = array();
		$schema_ready = $this->camera_settings_storage_ready() && $this->schema_ready();
		if ( ! $schema_ready ) {
			$reasons[] = 'secure_schema_unavailable';
		}
		$storage_ready = $schema_ready && null !== $this->ensure_storage_root();
		if ( $schema_ready && ! $storage_ready ) {
			$reasons[] = 'private_storage_unavailable';
		}
		$provider_ready = $storage_ready && $this->video_verifier_available();
		if ( $storage_ready && ! $provider_ready ) {
			$reasons[] = 'video_verifier_unavailable';
		}
		return array(
			'provider_ready'    => $provider_ready,
			'storage_ready'     => $storage_ready,
			'readiness_reason'  => $reasons[0] ?? null,
			'readiness_reasons' => $reasons,
		);
	}

	private function video_verifier_available(): bool {
		if ( false !== has_filter( 'avenra_halo_v2_incident_media_validate_segment' ) ) {
			return true;
		}
		if ( ! function_exists( 'wp_read_video_metadata' ) ) {
			$include = ABSPATH . 'wp-admin/includes/media.php';
			if ( is_file( $include ) ) {
				require_once $include;
			}
		}
		return function_exists( 'wp_read_video_metadata' );
	}

	private function grants_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'avenra_halo_v2_incident_media_grants';
	}

	private function media_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'avenra_halo_v2_incident_media';
	}

	private function token_hash( string $token ): string {
		return hash_hmac( 'sha256', $token, wp_salt( 'auth' ) );
	}

	/** @param array<string,mixed> $camera_settings */
	private function upload_grant_response( string $token, string $expires_at, array $camera_settings, bool $reused, int $status ): WP_REST_Response {
		return $this->success(
			array(
				'upload_token'          => $token,
				'expires_at'            => $this->rfc3339( $expires_at ),
				'reused'                => $reused,
				'upload_after_status'   => array( 'active', 'acknowledged' ),
				'max_segments_per_view' => self::MAX_SEGMENTS_PER_CAMERA,
				'max_segment_bytes'     => $this->max_segment_bytes(),
				'max_duration_ms'       => self::MAX_DURATION_MS,
				'camera_roles'          => ! empty( $camera_settings['dual_enabled'] ) ? array( 'rear', 'front' ) : array( 'rear' ),
				'mime_types'            => array( 'video/webm', 'video/mp4' ),
			),
			$status
		);
	}

	private function grant_lifetime(): int {
		return min( HOUR_IN_SECONDS, max( 5 * MINUTE_IN_SECONDS, (int) apply_filters( 'avenra_halo_v2_incident_media_grant_lifetime', 20 * MINUTE_IN_SECONDS ) ) );
	}

	private function max_segment_bytes(): int {
		return min( 50 * MB_IN_BYTES, max( MB_IN_BYTES, (int) apply_filters( 'avenra_halo_v2_incident_media_max_segment_bytes', 15 * MB_IN_BYTES ) ) );
	}

	private function max_incident_bytes(): int {
		return min( 500 * MB_IN_BYTES, max( 2 * $this->max_segment_bytes(), (int) apply_filters( 'avenra_halo_v2_incident_media_max_incident_bytes', 180 * MB_IN_BYTES ) ) );
	}

	private function retention_days(): int {
		return min( 3650, max( 1, (int) apply_filters( 'avenra_halo_v2_incident_media_retention_days', 30 ) ) );
	}

	/** @return array<string,mixed> */
	private function request_params( WP_REST_Request $request ): array {
		$params = $request->get_params();
		$json   = $request->get_json_params();
		return array_merge( is_array( $params ) ? $params : array(), is_array( $json ) ? $json : array() );
	}

	private function mysql_datetime( string $value ): ?string {
		$value = trim( $value );
		if ( '' === $value ) {
			return null;
		}
		$timestamp = strtotime( $value );
		return false === $timestamp ? null : gmdate( 'Y-m-d H:i:s', $timestamp );
	}

	private function boolean_value( mixed $value ): bool {
		if ( is_bool( $value ) ) {
			return $value;
		}
		if ( is_numeric( $value ) ) {
			return 1 === (int) $value;
		}
		return in_array( strtolower( trim( (string) $value ) ), array( '1', 'true', 'yes', 'on', 'enabled' ), true );
	}

	private function rfc3339( mixed $value ): ?string {
		if ( null === $value || '' === trim( (string) $value ) || str_starts_with( (string) $value, '0000-00-00' ) ) {
			return null;
		}
		$timestamp = strtotime( (string) $value . ( preg_match( '/(?:Z|[+-]\d{2}:?\d{2})$/', (string) $value ) ? '' : ' UTC' ) );
		return false === $timestamp ? null : gmdate( DATE_RFC3339, $timestamp );
	}

	private function responder_role( WP_REST_Request $request ): string {
		$role = sanitize_key( (string) ( $request->get_param( 'role' ) ?: $request->get_header( 'X-Halo-Responder-Role' ) ) );
		return in_array( $role, array( 'primary', 'backup' ), true ) ? $role : '';
	}

	private function responder_cookie_name( object $incident, string $role ): string {
		$public_id = strtolower( sanitize_text_field( (string) $incident->public_id ) );
		$role      = 'backup' === $role ? 'backup' : 'primary';
		$scope     = substr( hash_hmac( 'sha256', $public_id . '|' . $role, wp_salt( 'auth' ) ), 0, 24 );
		return self::RESPONDER_COOKIE . '_' . $role . '_' . $scope;
	}

	private function same_origin_read( WP_REST_Request $request ): bool {
		$fetch_site = strtolower( trim( (string) $request->get_header( 'Sec-Fetch-Site' ) ) );
		if ( in_array( $fetch_site, array( 'cross-site', 'same-site' ), true ) ) {
			return false;
		}
		$source = trim( (string) ( $request->get_header( 'Origin' ) ?: $request->get_header( 'Referer' ) ) );
		if ( '' === $source ) {
			return true;
		}
		$expected = wp_parse_url( home_url( '/' ) );
		$actual   = wp_parse_url( $source );
		if ( ! is_array( $expected ) || ! is_array( $actual ) ) {
			return false;
		}
		$expected_port = (int) ( $expected['port'] ?? ( 'https' === strtolower( (string) ( $expected['scheme'] ?? '' ) ) ? 443 : 80 ) );
		$actual_port   = (int) ( $actual['port'] ?? ( 'https' === strtolower( (string) ( $actual['scheme'] ?? '' ) ) ? 443 : 80 ) );
		return strtolower( (string) ( $expected['scheme'] ?? '' ) ) === strtolower( (string) ( $actual['scheme'] ?? '' ) )
			&& strtolower( (string) ( $expected['host'] ?? '' ) ) === strtolower( (string) ( $actual['host'] ?? '' ) )
			&& $expected_port === $actual_port;
	}

	/** @param array<string,mixed> $metadata */
	private function audit_operator( string $event_type, object $incident, array $metadata ): void {
		global $wpdb;
		$table = $this->db->table( 'operations_audit' );
		if ( ! $this->db->table_exists( $table ) ) {
			return;
		}
		$wpdb->insert(
			$table,
			array(
				'wp_user_id'         => get_current_user_id(),
				'event_type'         => substr( sanitize_key( $event_type ), 0, 48 ),
				'target_customer_id' => (int) $incident->customer_id,
				'incident_id'        => (int) $incident->id,
				'metadata_json'      => wp_json_encode( $this->safe_metadata( $metadata ) ),
				'created_at'         => current_time( 'mysql', true ),
			)
		);
	}

	/** @param array<string,mixed> $metadata */
	private function audit_responder( string $event_type, object $incident, string $role, array $metadata ): void {
		$metadata['role'] = in_array( $role, array( 'primary', 'backup' ), true ) ? $role : 'unknown';
		Avenra_Halo_V2_Emergency::instance()->append_event( (int) $incident->id, substr( sanitize_key( $event_type ), 0, 48 ), 'responder', $this->safe_metadata( $metadata ) );
	}

	/** @return array<string,mixed> */
	private function safe_metadata( array $metadata ): array {
		$safe = array();
		foreach ( $metadata as $key => $value ) {
			if ( is_scalar( $value ) || null === $value ) {
				$safe[ sanitize_key( (string) $key ) ] = is_string( $value ) ? substr( sanitize_text_field( $value ), 0, 100 ) : $value;
			}
		}
		return $safe;
	}

	private function private_response( array $data ): WP_REST_Response {
		$response = new WP_REST_Response( $data, 200 );
		$response->header( 'Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'X-Robots-Tag', 'noindex, nofollow, noarchive' );
		return $response;
	}

	private function success( array $data, int $status = 200 ): WP_REST_Response {
		return Avenra_Halo_V2_Response::success( $data, $status );
	}

	private function error( string $code, string $message, int $status, array $details = array() ): WP_REST_Response {
		return Avenra_Halo_V2_Response::error( $code, $message, $status, $details );
	}

	private function error_from_wp_error( WP_Error $error, int $default_status = 400 ): WP_REST_Response {
		$data   = $error->get_error_data();
		$status = is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : $default_status;
		$details = is_array( $data ) ? $data : array();
		unset( $details['status'] );
		return $this->error( sanitize_key( $error->get_error_code() ), $error->get_error_message(), $status, $details );
	}
}
