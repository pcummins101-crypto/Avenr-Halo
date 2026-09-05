<?php

defined( 'ABSPATH' ) || exit;

/**
 * Plugin-owned persistence. The existing avenra_customers and avenra_orders
 * tables remain the source of truth and are deliberately never created,
 * renamed, or altered here.
 */
final class Avenra_Halo_V2_Database {
	private static ?self $instance = null;

	/** @var array<string,array<string,bool>> */
	private array $column_cache = array();

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	public function table( string $name ): string {
		global $wpdb;

		$tables = array(
			'sessions'          => 'avenra_halo_v2_sessions',
			'rides'             => 'avenra_halo_v2_rides',
			'hazards'           => 'avenra_halo_v2_hazards',
			'live_tracking'     => 'avenra_halo_v2_live_tracking',
			'native_ride_sessions' => 'avenra_halo_v2_native_ride_sessions',
			'documents'         => 'avenra_halo_v2_documents',
			'vehicle_photos' => 'avenra_halo_v2_vehicle_photos',
			'emergency_settings'=> 'avenra_halo_v2_emergency_settings',
			'consent_events'    => 'avenra_halo_v2_emergency_consent_events',
			'incidents'         => 'avenra_halo_v2_incidents',
			'incident_events'   => 'avenra_halo_v2_incident_events',
			'presence'          => 'avenra_halo_v2_presence',
			'risk_profiles'     => 'avenra_halo_v2_risk_profiles',
			'operations_audit'  => 'avenra_halo_v2_operations_audit',
			'community_profiles'=> 'avenra_halo_v2_community_profiles',
			'community_threads' => 'avenra_halo_v2_community_threads',
			'community_replies' => 'avenra_halo_v2_community_replies',
			'community_conversations' => 'avenra_halo_v2_community_conversations',
			'community_messages'=> 'avenra_halo_v2_community_messages',
			'community_blocks'  => 'avenra_halo_v2_community_blocks',
			'community_reports' => 'avenra_halo_v2_community_reports',
			'community_moderation_events' => 'avenra_halo_v2_community_moderation_events',
			'customers'         => 'avenra_customers',
			'orders'            => 'avenra_orders',
		);

		if ( ! isset( $tables[ $name ] ) ) {
			throw new InvalidArgumentException( 'Unknown Halo table.' );
		}

		return $wpdb->prefix . $tables[ $name ];
	}

	public static function install(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$self    = self::instance();
		$charset = $wpdb->get_charset_collate();

		$sql = array();

		$sql[] = 'CREATE TABLE ' . $self->table( 'sessions' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			customer_id bigint(20) unsigned NOT NULL,
			token_hash char(64) NOT NULL,
			csrf_hash char(64) NOT NULL,
			ip_hash char(64) NOT NULL DEFAULT '',
			user_agent_hash char(64) NOT NULL DEFAULT '',
			created_at datetime NOT NULL,
			last_seen_at datetime NOT NULL,
			expires_at datetime NOT NULL,
			revoked_at datetime DEFAULT NULL,
			metadata_json longtext NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY token_hash (token_hash),
			KEY customer_active (customer_id,revoked_at),
			KEY expires_at (expires_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'rides' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			customer_id bigint(20) unsigned NOT NULL,
			vehicle_order_id bigint(20) unsigned DEFAULT NULL,
			client_ride_id varchar(64) DEFAULT NULL,
			started_at datetime NOT NULL,
			ended_at datetime DEFAULT NULL,
			duration_seconds int(10) unsigned NOT NULL DEFAULT 0,
			distance_miles decimal(10,3) NOT NULL DEFAULT 0,
			energy_wh decimal(12,2) DEFAULT NULL,
			average_speed_mph decimal(7,2) DEFAULT NULL,
			top_speed_mph decimal(7,2) NOT NULL DEFAULT 0,
			best_zero_to_sixty decimal(7,3) DEFAULT NULL,
			max_lean_left decimal(6,2) NOT NULL DEFAULT 0,
			max_lean_right decimal(6,2) NOT NULL DEFAULT 0,
			start_lat decimal(10,7) DEFAULT NULL,
			start_lng decimal(10,7) DEFAULT NULL,
			end_lat decimal(10,7) DEFAULT NULL,
			end_lng decimal(10,7) DEFAULT NULL,
			start_location varchar(255) DEFAULT NULL,
			end_location varchar(255) DEFAULT NULL,
			route_json longtext NULL,
			telemetry_json longtext NULL,
			ride_mode varchar(24) DEFAULT NULL,
			peak_g_force decimal(7,3) DEFAULT NULL,
			harsh_event_count int(10) unsigned NOT NULL DEFAULT 0,
			telemetry_quality varchar(24) DEFAULT NULL,
			status varchar(24) NOT NULL DEFAULT 'complete',
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			UNIQUE KEY customer_client_ride (customer_id,client_ride_id),
			KEY customer_started (customer_id,started_at),
			KEY vehicle_order_id (vehicle_order_id)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'hazards' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			customer_id bigint(20) unsigned NOT NULL,
			ride_id bigint(20) unsigned DEFAULT NULL,
			hazard_type varchar(48) NOT NULL,
			severity tinyint(3) unsigned NOT NULL DEFAULT 2,
			latitude decimal(10,7) NOT NULL,
			longitude decimal(10,7) NOT NULL,
			note varchar(280) DEFAULT NULL,
			photo_attachment_id bigint(20) unsigned DEFAULT NULL,
			status varchar(20) NOT NULL DEFAULT 'active',
			confirmations int(10) unsigned NOT NULL DEFAULT 0,
			disputes int(10) unsigned NOT NULL DEFAULT 0,
			reported_at datetime NOT NULL,
			expires_at datetime DEFAULT NULL,
			resolved_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			KEY active_area (status,latitude,longitude),
			KEY expires_at (expires_at),
			KEY customer_id (customer_id)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'live_tracking' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) DEFAULT NULL,
			customer_id bigint(20) unsigned NOT NULL,
			ride_id bigint(20) unsigned DEFAULT NULL,
			tracking_mode varchar(24) NOT NULL DEFAULT 'rider_share',
			auth_session_id bigint(20) unsigned DEFAULT NULL,
			client_ride_id varchar(80) DEFAULT NULL,
			arm_id varchar(64) DEFAULT NULL,
			consent_version varchar(32) DEFAULT NULL,
			consented_at datetime DEFAULT NULL,
			ended_reason varchar(32) DEFAULT NULL,
			viewer_token_hash char(64) NOT NULL,
			writer_token_hash char(64) NOT NULL,
			guardian_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			guardian_token_hash char(64) DEFAULT NULL,
			guardian_label varchar(80) NOT NULL DEFAULT '',
			started_at datetime NOT NULL,
			expires_at datetime NOT NULL,
			ended_at datetime DEFAULT NULL,
			last_sequence bigint(20) unsigned NOT NULL DEFAULT 0,
			latitude decimal(10,7) DEFAULT NULL,
			longitude decimal(10,7) DEFAULT NULL,
			speed_mph decimal(7,2) NOT NULL DEFAULT 0,
			top_speed_mph decimal(7,2) NOT NULL DEFAULT 0,
			road_name varchar(190) DEFAULT NULL,
			heading decimal(6,2) DEFAULT NULL,
			accuracy_m decimal(8,2) DEFAULT NULL,
			last_ping_at datetime DEFAULT NULL,
			recovery_request_id varchar(80) DEFAULT NULL,
			recovery_request_count int(10) unsigned NOT NULL DEFAULT 0,
			recovery_requested_at datetime DEFAULT NULL,
			recovery_acknowledged_at datetime DEFAULT NULL,
			recovery_resumed_at datetime DEFAULT NULL,
			recovery_notification_attempted_at datetime DEFAULT NULL,
			recovery_notified_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			UNIQUE KEY viewer_token_hash (viewer_token_hash),
			UNIQUE KEY guardian_token_hash (guardian_token_hash),
			UNIQUE KEY customer_client_mode (customer_id,client_ride_id,tracking_mode),
			KEY customer_active (customer_id,ended_at),
			KEY mode_active (tracking_mode,ended_at,expires_at),
			KEY customer_mode_arm (customer_id,tracking_mode,arm_id),
			KEY auth_session_id (auth_session_id),
			KEY recovery_request_id (recovery_request_id),
			KEY expires_at (expires_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'native_ride_sessions' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			customer_id bigint(20) unsigned NOT NULL,
			auth_session_id bigint(20) unsigned NOT NULL,
			client_ride_id varchar(80) NOT NULL,
			token_hash char(64) NOT NULL,
			monitoring_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			started_at datetime NOT NULL,
			expires_at datetime NOT NULL,
			last_ping_at datetime DEFAULT NULL,
			last_recorded_at datetime DEFAULT NULL,
			last_sequence bigint(20) unsigned NOT NULL DEFAULT 0,
			latitude decimal(10,7) DEFAULT NULL,
			longitude decimal(10,7) DEFAULT NULL,
			altitude decimal(9,2) DEFAULT NULL,
			accuracy_m decimal(8,2) DEFAULT NULL,
			heading decimal(6,2) DEFAULT NULL,
			speed_mph decimal(7,2) DEFAULT NULL,
			device_id varchar(190) DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			UNIQUE KEY token_hash (token_hash),
			UNIQUE KEY customer_id (customer_id),
			KEY auth_session_id (auth_session_id),
			KEY expires_at (expires_at),
			KEY client_ride_id (client_ride_id)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'documents' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			customer_id bigint(20) unsigned NOT NULL,
			vehicle_order_id bigint(20) unsigned DEFAULT NULL,
			document_type varchar(40) NOT NULL DEFAULT 'other',
			title varchar(190) NOT NULL,
			original_filename varchar(255) NOT NULL,
			storage_key varchar(255) NOT NULL,
			mime_type varchar(100) NOT NULL,
			file_size bigint(20) unsigned NOT NULL DEFAULT 0,
			status varchar(20) NOT NULL DEFAULT 'active',
			issued_at date DEFAULT NULL,
			expires_at date DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			KEY customer_status (customer_id,status),
			KEY vehicle_order_id (vehicle_order_id)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'vehicle_photos' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			customer_id bigint(20) unsigned NOT NULL,
			vehicle_order_id bigint(20) unsigned NOT NULL,
			storage_key varchar(255) NOT NULL,
			mime_type varchar(100) NOT NULL,
			original_filename varchar(255) NOT NULL,
			file_size bigint(20) unsigned NOT NULL DEFAULT 0,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY vehicle_order_id (vehicle_order_id),
			KEY customer_id (customer_id)
			) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'emergency_settings' ) . " (
			customer_id bigint(20) unsigned NOT NULL,
			assist_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			consent_version varchar(32) NOT NULL DEFAULT '',
			consented_at datetime DEFAULT NULL,
			revoked_at datetime DEFAULT NULL,
			medical_sharing_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			medical_consent_version varchar(32) NOT NULL DEFAULT '',
			medical_consented_at datetime DEFAULT NULL,
			medical_revoked_at datetime DEFAULT NULL,
			incident_camera_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			incident_camera_dual_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			incident_camera_consent_version varchar(32) NOT NULL DEFAULT '',
			incident_camera_consented_at datetime DEFAULT NULL,
			incident_camera_revoked_at datetime DEFAULT NULL,
			test_ride_monitoring_armed tinyint(1) unsigned NOT NULL DEFAULT 0,
			test_ride_monitoring_arm_id varchar(64) DEFAULT NULL,
			test_ride_monitoring_consent_version varchar(32) NOT NULL DEFAULT '',
			test_ride_monitoring_consented_at datetime DEFAULT NULL,
			test_ride_monitoring_revoked_at datetime DEFAULT NULL,
			test_ride_monitoring_armed_until datetime DEFAULT NULL,
			nok_alerts_enabled tinyint(1) unsigned DEFAULT NULL,
			proxy_authority_enabled tinyint(1) unsigned DEFAULT NULL,
			law_release_enabled tinyint(1) unsigned DEFAULT NULL,
			research_enabled tinyint(1) unsigned DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (customer_id),
			KEY assist_enabled (assist_enabled),
			KEY test_ride_armed_until (test_ride_monitoring_armed,test_ride_monitoring_armed_until)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'consent_events' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			customer_id bigint(20) unsigned NOT NULL,
			event_type varchar(32) NOT NULL,
			previous_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			new_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			previous_version varchar(32) NOT NULL DEFAULT '',
			new_version varchar(32) NOT NULL DEFAULT '',
			occurred_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY customer_occurred (customer_id,occurred_at),
			KEY event_type (event_type)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'incidents' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			customer_id bigint(20) unsigned NOT NULL,
			client_event_id varchar(80) NOT NULL,
			client_ride_id varchar(80) DEFAULT NULL,
			source varchar(24) NOT NULL DEFAULT 'automatic',
			is_test tinyint(1) unsigned NOT NULL DEFAULT 0,
			test_dispatch_mode varchar(24) DEFAULT NULL,
			test_scenario varchar(32) DEFAULT NULL,
			status varchar(32) NOT NULL DEFAULT 'candidate',
			occurred_at datetime NOT NULL,
			activation_due_at datetime DEFAULT NULL,
			activated_at datetime DEFAULT NULL,
			snapshot_ciphertext longtext NULL,
			snapshot_redacted_at datetime DEFAULT NULL,
			primary_token_hash char(64) DEFAULT NULL,
			primary_session_hash char(64) DEFAULT NULL,
			primary_expires_at datetime DEFAULT NULL,
			primary_status varchar(24) NOT NULL DEFAULT 'pending',
			primary_provider_id varchar(100) DEFAULT NULL,
			primary_sent_at datetime DEFAULT NULL,
			backup_token_hash char(64) DEFAULT NULL,
			backup_session_hash char(64) DEFAULT NULL,
			backup_expires_at datetime DEFAULT NULL,
			backup_status varchar(24) NOT NULL DEFAULT 'pending',
			backup_provider_id varchar(100) DEFAULT NULL,
			backup_sent_at datetime DEFAULT NULL,
			escalation_due_at datetime DEFAULT NULL,
			first_acknowledged_at datetime DEFAULT NULL,
			first_acknowledged_by varchar(32) DEFAULT NULL,
			acknowledger_ciphertext longtext NULL,
			rider_call_result varchar(24) DEFAULT NULL,
			emergency_services_called_at datetime DEFAULT NULL,
			nok_notification_status varchar(24) DEFAULT NULL,
			nok_notified_at datetime DEFAULT NULL,
			resolved_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			UNIQUE KEY customer_client_event (customer_id,client_event_id),
			KEY customer_ride_active (customer_id,client_ride_id,status),
			KEY candidate_due (status,activation_due_at),
			KEY status_due (status,escalation_due_at),
			KEY customer_created (customer_id,created_at),
			KEY primary_session_hash (primary_session_hash),
			KEY backup_session_hash (backup_session_hash)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'incident_events' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			incident_id bigint(20) unsigned NOT NULL,
			event_type varchar(48) NOT NULL,
			actor_role varchar(24) NOT NULL DEFAULT 'system',
			metadata_json text NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY incident_created (incident_id,created_at),
			KEY event_type (event_type)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'presence' ) . " (
			session_id bigint(20) unsigned NOT NULL,
			customer_id bigint(20) unsigned NOT NULL,
			is_riding tinyint(1) unsigned NOT NULL DEFAULT 0,
			monitoring_enabled tinyint(1) unsigned NOT NULL DEFAULT 0,
			client_ride_id varchar(64) DEFAULT NULL,
			vehicle_order_id bigint(20) unsigned DEFAULT NULL,
			ride_started_at datetime DEFAULT NULL,
			speed_mph decimal(7,2) DEFAULT NULL,
			top_speed_mph decimal(7,2) DEFAULT NULL,
			latitude decimal(10,7) DEFAULT NULL,
			longitude decimal(10,7) DEFAULT NULL,
			accuracy_m decimal(8,2) DEFAULT NULL,
			heading decimal(6,2) DEFAULT NULL,
			device_state_json text NULL,
			last_ping_at datetime NOT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (session_id),
			KEY riding_ping (is_riding,last_ping_at),
			KEY customer_ping (customer_id,last_ping_at),
			KEY last_ping_at (last_ping_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'risk_profiles' ) . " (
			customer_id bigint(20) unsigned NOT NULL,
			score decimal(5,2) DEFAULT NULL,
			risk_level varchar(24) NOT NULL DEFAULT 'insufficient',
			confidence varchar(24) NOT NULL DEFAULT 'insufficient',
			ride_count int(10) unsigned NOT NULL DEFAULT 0,
			total_miles decimal(12,3) NOT NULL DEFAULT 0,
			factors_json longtext NULL,
			model_version varchar(24) NOT NULL,
			window_started_at datetime DEFAULT NULL,
			calculated_at datetime NOT NULL,
			PRIMARY KEY  (customer_id),
			KEY score (score),
			KEY calculated_at (calculated_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'operations_audit' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			wp_user_id bigint(20) unsigned NOT NULL,
			event_type varchar(48) NOT NULL,
			target_customer_id bigint(20) unsigned DEFAULT NULL,
			incident_id bigint(20) unsigned DEFAULT NULL,
			metadata_json text NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY user_created (wp_user_id,created_at),
			KEY incident_created (incident_id,created_at),
			KEY event_type (event_type)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_profiles' ) . " (
			customer_id bigint(20) unsigned NOT NULL,
			public_id char(36) NOT NULL,
			username varchar(24) DEFAULT NULL,
			username_normalized varchar(24) DEFAULT NULL,
			bio varchar(280) NOT NULL DEFAULT '',
			allow_dms tinyint(1) unsigned NOT NULL DEFAULT 0,
			directory_visible tinyint(1) unsigned NOT NULL DEFAULT 0,
			status varchar(24) NOT NULL DEFAULT 'deactivated',
			terms_version varchar(24) NOT NULL DEFAULT '',
			opted_in_at datetime DEFAULT NULL,
			deactivated_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (customer_id),
			UNIQUE KEY public_id (public_id),
			UNIQUE KEY username_normalized (username_normalized),
			KEY directory_username (status,directory_visible,username),
			KEY updated_at (updated_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_threads' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			author_customer_id bigint(20) unsigned NOT NULL,
			title varchar(100) NOT NULL,
			body text NOT NULL,
			status varchar(24) NOT NULL DEFAULT 'active',
			reply_count int(10) unsigned NOT NULL DEFAULT 0,
			last_activity_at datetime NOT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			KEY status_activity (status,last_activity_at),
			KEY author_created (author_customer_id,created_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_replies' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			thread_id bigint(20) unsigned NOT NULL,
			author_customer_id bigint(20) unsigned NOT NULL,
			body text NOT NULL,
			status varchar(24) NOT NULL DEFAULT 'active',
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			KEY thread_created (thread_id,created_at),
			KEY author_created (author_customer_id,created_at),
			KEY status (status)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_conversations' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			customer_low_id bigint(20) unsigned NOT NULL,
			customer_high_id bigint(20) unsigned NOT NULL,
			last_message_at datetime NOT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			UNIQUE KEY member_pair (customer_low_id,customer_high_id),
			KEY low_activity (customer_low_id,last_message_at),
			KEY high_activity (customer_high_id,last_message_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_messages' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			conversation_id bigint(20) unsigned NOT NULL,
			sender_customer_id bigint(20) unsigned NOT NULL,
			recipient_customer_id bigint(20) unsigned NOT NULL,
			body text NOT NULL,
			status varchar(24) NOT NULL DEFAULT 'sent',
			read_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			KEY conversation_created (conversation_id,created_at),
			KEY recipient_unread (recipient_customer_id,status,read_at),
			KEY sender_created (sender_customer_id,created_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_blocks' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			blocker_customer_id bigint(20) unsigned NOT NULL,
			blocked_customer_id bigint(20) unsigned NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY block_pair (blocker_customer_id,blocked_customer_id),
			KEY blocked_customer_id (blocked_customer_id),
			KEY blocker_created (blocker_customer_id,created_at)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_reports' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			public_id char(36) NOT NULL,
			reporter_customer_id bigint(20) unsigned NOT NULL,
			target_type varchar(24) NOT NULL,
			target_public_id char(36) NOT NULL,
			target_customer_id bigint(20) unsigned NOT NULL,
			reason varchar(32) NOT NULL,
			details varchar(500) NOT NULL DEFAULT '',
			status varchar(24) NOT NULL DEFAULT 'open',
			moderator_wp_user_id bigint(20) unsigned DEFAULT NULL,
			resolution_note varchar(500) NOT NULL DEFAULT '',
			resolved_at datetime DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY public_id (public_id),
			UNIQUE KEY reporter_target (reporter_customer_id,target_type,target_public_id),
			KEY status_created (status,created_at),
			KEY target_customer (target_customer_id,status),
			KEY target_lookup (target_type,target_public_id)
		) {$charset};";

		$sql[] = 'CREATE TABLE ' . $self->table( 'community_moderation_events' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			report_id bigint(20) unsigned NOT NULL,
			wp_user_id bigint(20) unsigned NOT NULL,
			action varchar(32) NOT NULL,
			metadata_json text NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY report_created (report_id,created_at),
			KEY moderator_created (wp_user_id,created_at)
		) {$charset};";

		$statement_failures = 0;
		foreach ( $sql as $statement ) {
			$wpdb->last_error = '';
			dbDelta( $statement );
			if ( '' !== trim( (string) $wpdb->last_error ) ) {
				++$statement_failures;
			}
		}

		// public_id is nullable during dbDelta so an existing installation can add
		// its unique index without assigning the same empty value to every old row.
		// Backfill each legacy tracking row independently before advertising the
		// migrated schema. New rows always receive a UUID at creation time.
		$self->column_cache = array();
		$live_table = $self->table( 'live_tracking' );
		if ( $self->table_exists( $live_table ) && $self->has_column( $live_table, 'public_id' ) ) {
			$legacy_live_ids = $wpdb->get_col( "SELECT id FROM `" . esc_sql( $live_table ) . "` WHERE public_id IS NULL OR public_id = ''" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( is_array( $legacy_live_ids ) ) {
				foreach ( $legacy_live_ids as $legacy_live_id ) {
					$backfilled = $wpdb->query(
						$wpdb->prepare(
							"UPDATE `" . esc_sql( $live_table ) . "` SET public_id = %s WHERE id = %d AND (public_id IS NULL OR public_id = '')", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
							wp_generate_uuid4(),
							(int) $legacy_live_id
						)
					);
					if ( false === $backfilled ) {
						++$statement_failures;
					}
				}
			}
			$remaining_legacy_rows = (int) $wpdb->get_var( "SELECT COUNT(*) FROM `" . esc_sql( $live_table ) . "` WHERE public_id IS NULL OR public_id = ''" ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( $remaining_legacy_rows > 0 || '' !== trim( (string) $wpdb->last_error ) ) {
				++$statement_failures;
			}
		}

		// dbDelta can return after a partial migration. Re-read the real schema and
		// only advertise this release when every owned table and safety-critical
		// Emergency Assist/Community column exists. Never expose raw SQL or database errors in
		// the failure hook.
		$self->column_cache = array();
		$required = array(
			'sessions'          => array( 'id', 'customer_id', 'token_hash', 'csrf_hash', 'created_at', 'last_seen_at', 'expires_at', 'revoked_at', 'metadata_json' ),
			'rides'             => array( 'id', 'public_id', 'customer_id', 'started_at', 'duration_seconds', 'distance_miles', 'top_speed_mph', 'route_json', 'telemetry_json', 'ride_mode', 'peak_g_force', 'harsh_event_count', 'telemetry_quality', 'status' ),
			'hazards'           => array( 'id', 'public_id', 'customer_id', 'hazard_type', 'latitude', 'longitude', 'status', 'reported_at' ),
			'live_tracking'     => array( 'id', 'public_id', 'customer_id', 'tracking_mode', 'auth_session_id', 'client_ride_id', 'arm_id', 'consent_version', 'consented_at', 'ended_reason', 'viewer_token_hash', 'writer_token_hash', 'guardian_enabled', 'guardian_token_hash', 'guardian_label', 'expires_at', 'ended_at', 'latitude', 'longitude', 'speed_mph', 'top_speed_mph', 'road_name', 'last_ping_at', 'recovery_request_id', 'recovery_request_count', 'recovery_requested_at', 'recovery_acknowledged_at', 'recovery_resumed_at', 'recovery_notification_attempted_at', 'recovery_notified_at' ),
			'native_ride_sessions' => array( 'id', 'public_id', 'customer_id', 'auth_session_id', 'client_ride_id', 'token_hash', 'monitoring_enabled', 'started_at', 'expires_at', 'last_ping_at', 'last_recorded_at', 'last_sequence', 'latitude', 'longitude', 'altitude', 'accuracy_m', 'heading', 'speed_mph', 'device_id' ),
			'documents'         => array( 'id', 'public_id', 'customer_id', 'storage_key', 'mime_type', 'status', 'created_at' ),
			'vehicle_photos'    => array( 'id', 'customer_id', 'vehicle_order_id', 'storage_key', 'mime_type', 'created_at' ),
			'emergency_settings'=> array( 'customer_id', 'assist_enabled', 'consent_version', 'medical_sharing_enabled', 'medical_consent_version', 'incident_camera_enabled', 'incident_camera_dual_enabled', 'incident_camera_consent_version', 'incident_camera_consented_at', 'incident_camera_revoked_at', 'test_ride_monitoring_armed', 'test_ride_monitoring_arm_id', 'test_ride_monitoring_consent_version', 'test_ride_monitoring_consented_at', 'test_ride_monitoring_revoked_at', 'test_ride_monitoring_armed_until', 'nok_alerts_enabled', 'proxy_authority_enabled', 'law_release_enabled', 'research_enabled', 'updated_at' ),
			'consent_events'    => array( 'id', 'customer_id', 'event_type', 'new_enabled', 'new_version', 'occurred_at' ),
			'incidents'         => array( 'id', 'public_id', 'customer_id', 'client_event_id', 'client_ride_id', 'source', 'is_test', 'test_dispatch_mode', 'test_scenario', 'status', 'activation_due_at', 'snapshot_ciphertext', 'snapshot_redacted_at', 'first_acknowledged_at', 'first_acknowledged_by', 'resolved_at' ),
			'incident_events'   => array( 'id', 'incident_id', 'event_type', 'actor_role', 'metadata_json', 'created_at' ),
			'presence'          => array( 'session_id', 'customer_id', 'is_riding', 'monitoring_enabled', 'speed_mph', 'latitude', 'longitude', 'last_ping_at' ),
			'risk_profiles'     => array( 'customer_id', 'score', 'risk_level', 'confidence', 'ride_count', 'total_miles', 'factors_json', 'model_version', 'calculated_at' ),
			'operations_audit'  => array( 'id', 'wp_user_id', 'event_type', 'target_customer_id', 'incident_id', 'metadata_json', 'created_at' ),
			'community_profiles'=> array( 'customer_id', 'public_id', 'username', 'username_normalized', 'bio', 'allow_dms', 'directory_visible', 'status', 'terms_version', 'opted_in_at', 'deactivated_at' ),
			'community_threads' => array( 'id', 'public_id', 'author_customer_id', 'title', 'body', 'status', 'reply_count', 'last_activity_at' ),
			'community_replies' => array( 'id', 'public_id', 'thread_id', 'author_customer_id', 'body', 'status', 'created_at' ),
			'community_conversations' => array( 'id', 'public_id', 'customer_low_id', 'customer_high_id', 'last_message_at' ),
			'community_messages'=> array( 'id', 'public_id', 'conversation_id', 'sender_customer_id', 'recipient_customer_id', 'body', 'status', 'read_at' ),
			'community_blocks'  => array( 'id', 'blocker_customer_id', 'blocked_customer_id', 'created_at' ),
			'community_reports' => array( 'id', 'public_id', 'reporter_customer_id', 'target_type', 'target_public_id', 'target_customer_id', 'reason', 'details', 'status', 'moderator_wp_user_id', 'resolution_note' ),
			'community_moderation_events' => array( 'id', 'report_id', 'wp_user_id', 'action', 'metadata_json', 'created_at' ),
		);
		$missing = array();
		foreach ( $required as $name => $columns ) {
			$table = $self->table( $name );
			if ( ! $self->table_exists( $table ) ) {
				$missing[] = $name . ':table';
				continue;
			}
			$actual = $self->columns( $table );
			foreach ( $columns as $column ) {
				if ( ! isset( $actual[ $column ] ) ) {
					$missing[] = $name . ':' . $column;
				}
			}
		}
		if ( 0 === $statement_failures && ! $missing ) {
			update_option( 'avenra_halo_v2_db_version', AVENRA_HALO_V2_VERSION, false );
		} else {
			do_action(
				'avenra_halo_v2_database_install_failed',
				array(
					'request_id'         => class_exists( 'Avenra_Halo_V2_Response' ) ? Avenra_Halo_V2_Response::request_id() : wp_generate_uuid4(),
					'statement_failures' => $statement_failures,
					'missing'            => array_slice( $missing, 0, 100 ),
				)
			);
		}
		self::protect_private_upload_directory();
	}

	private static function protect_private_upload_directory(): void {
		$uploads = wp_upload_dir();
		if ( ! empty( $uploads['error'] ) ) {
			return;
		}

		$directory = trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private';
		if ( ! wp_mkdir_p( $directory ) ) {
			return;
		}

		$htaccess = $directory . '/.htaccess';
		if ( ! file_exists( $htaccess ) ) {
			// Apache 2.4 and 2.2 syntax. Nginx installations should deny this path too.
			file_put_contents( $htaccess, "Require all denied\nDeny from all\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		}

		$index = $directory . '/index.php';
		if ( ! file_exists( $index ) ) {
			file_put_contents( $index, "<?php\nhttp_response_code( 404 );\nexit;\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		}
	}

	public function source_tables_ready(): bool {
		return $this->table_exists( $this->table( 'customers' ) ) && $this->table_exists( $this->table( 'orders' ) );
	}

	public function table_exists( string $table ): bool {
		global $wpdb;

		$found = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
		return $found === $table;
	}

	/** @return array<string,bool> */
	public function columns( string $table ): array {
		global $wpdb;

		if ( isset( $this->column_cache[ $table ] ) ) {
			return $this->column_cache[ $table ];
		}

		if ( ! $this->table_exists( $table ) ) {
			$this->column_cache[ $table ] = array();
			return array();
		}

		$rows    = $wpdb->get_results( 'SHOW COLUMNS FROM `' . esc_sql( $table ) . '`' ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$columns = array();
		foreach ( $rows as $row ) {
			$columns[ (string) $row->Field ] = true;
		}

		$this->column_cache[ $table ] = $columns;
		return $columns;
	}

	public function has_column( string $table, string $column ): bool {
		$columns = $this->columns( $table );
		return isset( $columns[ $column ] );
	}

	/**
	 * Filters writes against the real target schema, keeping V2 compatible with
	 * older installations that have not yet received every optional field.
	 *
	 * @param array<string,mixed> $data Values keyed by column name.
	 * @return array<string,mixed>
	 */
	public function supported_data( string $table, array $data ): array {
		$columns = $this->columns( $table );
		return array_intersect_key( $data, $columns );
	}

	/**
	 * Consume one attempt from a privacy-preserving rate-limit bucket.
	 *
	 * A MySQL advisory lock serialises the transient read/update even when the
	 * site uses Redis or Memcached for transients. This avoids the classic
	 * get_transient()/set_transient() race where several parallel PIN attempts
	 * can all observe the same counter. Failure to acquire the lock fails closed.
	 */
	public function consume_rate_limit( string $scope, string $identifier, int $limit, int $window ): bool {
		global $wpdb;

		$scope      = sanitize_key( $scope );
		$limit      = max( 1, $limit );
		$window     = max( MINUTE_IN_SECONDS, $window );
		$key_hash   = hash_hmac( 'sha256', $scope . '|' . strtolower( trim( $identifier ) ), wp_salt( 'auth' ) );
		$key        = 'avh2_rl_' . substr( $key_hash, 0, 40 );
		$lock_name  = 'avh2_rl_' . substr( $key_hash, 0, 48 );
		$lock_wait  = max( 0, min( 3, (int) apply_filters( 'avenra_halo_v2_rate_limit_lock_wait', 1, $scope ) ) );
		$lock       = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, $lock_wait ) );
		if ( 1 !== $lock ) {
			do_action( 'avenra_halo_v2_rate_limit_lock_failed', $scope, Avenra_Halo_V2_Response::request_id() );
			return false;
		}

		try {
			$now   = time();
			$stored = get_transient( $key );
			if ( is_array( $stored ) ) {
				$count    = max( 0, (int) ( $stored['count'] ?? 0 ) );
				$reset_at = max( 0, (int) ( $stored['reset_at'] ?? 0 ) );
			} else {
				// Upgrade older integer buckets into one fixed window. The expiry is
				// no longer refreshed on every request, so a steady stream cannot
				// create an accidental permanent lockout.
				$count    = max( 0, (int) $stored );
				$reset_at = $now + $window;
			}
			if ( $reset_at <= $now ) {
				$count    = 0;
				$reset_at = $now + $window;
			}
			if ( $count >= $limit ) {
				return false;
			}

			return (bool) set_transient(
				$key,
				array( 'count' => $count + 1, 'reset_at' => $reset_at ),
				max( 1, $reset_at - $now )
			);
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
		}
	}

	/** Clear a rate-limit bucket after a verified success or retryable failure. */
	public function clear_rate_limit( string $scope, string $identifier ): void {
		global $wpdb;

		$scope     = sanitize_key( $scope );
		$key_hash  = hash_hmac( 'sha256', $scope . '|' . strtolower( trim( $identifier ) ), wp_salt( 'auth' ) );
		$key       = 'avh2_rl_' . substr( $key_hash, 0, 40 );
		$lock_name = 'avh2_rl_' . substr( $key_hash, 0, 48 );
		$lock      = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, 1 ) );
		if ( 1 !== $lock ) {
			return;
		}

		try {
			delete_transient( $key );
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
		}
	}

	/** Store a short-lived secret hash without retaining the submitted PII. */
	public function store_one_time_secret( string $scope, string $identifier, string $secret_hash, int $lifetime ): bool {
		global $wpdb;

		$scope      = sanitize_key( $scope );
		$key_hash   = hash_hmac( 'sha256', $scope . '|' . strtolower( trim( $identifier ) ), wp_salt( 'auth' ) );
		$key        = 'avh2_otp_' . substr( $key_hash, 0, 40 );
		$lock_name  = 'avh2_otp_' . substr( $key_hash, 0, 47 );
		$lock       = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, 1 ) );
		if ( 1 !== $lock ) {
			return false;
		}

		try {
			return (bool) set_transient(
				$key,
				array( 'hash' => $secret_hash, 'created_at' => time() ),
				max( MINUTE_IN_SECONDS, $lifetime )
			);
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
		}
	}

	/** Atomically verify and consume a one-time secret. */
	public function consume_one_time_secret( string $scope, string $identifier, string $candidate ): bool {
		global $wpdb;

		$scope      = sanitize_key( $scope );
		$key_hash   = hash_hmac( 'sha256', $scope . '|' . strtolower( trim( $identifier ) ), wp_salt( 'auth' ) );
		$key        = 'avh2_otp_' . substr( $key_hash, 0, 40 );
		$lock_name  = 'avh2_otp_' . substr( $key_hash, 0, 47 );
		$lock       = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, 1 ) );
		if ( 1 !== $lock ) {
			return false;
		}

		try {
			$stored = get_transient( $key );
			$valid  = is_array( $stored ) && ! empty( $stored['hash'] ) && wp_check_password( $candidate, (string) $stored['hash'] );
			if ( $valid ) {
				delete_transient( $key );
			}
			return $valid;
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
		}
	}

	public function clear_one_time_secret( string $scope, string $identifier ): void {
		global $wpdb;

		$scope      = sanitize_key( $scope );
		$key_hash   = hash_hmac( 'sha256', $scope . '|' . strtolower( trim( $identifier ) ), wp_salt( 'auth' ) );
		$key        = 'avh2_otp_' . substr( $key_hash, 0, 40 );
		$lock_name  = 'avh2_otp_' . substr( $key_hash, 0, 47 );
		$lock       = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock_name, 1 ) );
		if ( 1 !== $lock ) {
			return;
		}
		try {
			delete_transient( $key );
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
		}
	}

	/** Acquire a short, privacy-preserving application lock. */
	public function acquire_advisory_lock( string $scope, string $identifier, int $wait_seconds = 2 ): ?string {
		global $wpdb;

		$digest = hash_hmac( 'sha256', sanitize_key( $scope ) . '|' . strtolower( trim( $identifier ) ), wp_salt( 'auth' ) );
		$name   = 'avh2_op_' . substr( $digest, 0, 48 );
		$locked = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $name, max( 0, min( 5, $wait_seconds ) ) ) );
		return 1 === $locked ? $name : null;
	}

	public function release_advisory_lock( string $name ): void {
		global $wpdb;
		if ( str_starts_with( $name, 'avh2_op_' ) ) {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $name ) );
		}
	}

	public function customer_by_id( int $customer_id ): ?object {
		global $wpdb;

		if ( $customer_id < 1 || ! $this->source_tables_ready() ) {
			return null;
		}

		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->table( 'customers' ) ) . '` WHERE id = %d LIMIT 1', $customer_id ) // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		);

		return is_object( $row ) ? $row : null;
	}

	public function customer_by_email( string $email ): ?object {
		global $wpdb;

		$table = $this->table( 'customers' );
		if ( ! $this->table_exists( $table ) ) {
			return null;
		}

		$email = strtolower( trim( $email ) );
		if ( $this->has_column( $table, 'email_normalized' ) ) {
			$sql = $wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $table ) . '` WHERE email_normalized = %s OR LOWER(email_address) = %s ORDER BY id ASC LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$email,
				$email
			);
		} else {
			$sql = $wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $table ) . '` WHERE LOWER(email_address) = %s ORDER BY id ASC LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$email
			);
		}

		$row = $wpdb->get_row( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	public function order_belongs_to_customer( int $order_id, int $customer_id ): bool {
		global $wpdb;

		if ( $order_id < 1 || $customer_id < 1 ) {
			return false;
		}

		$value = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT id FROM `' . esc_sql( $this->table( 'orders' ) ) . '` WHERE id = %d AND customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$order_id,
				$customer_id
			)
		);

		return (int) $value === $order_id;
	}

	public function cleanup(): void {
		global $wpdb;

		$now                       = gmdate( 'Y-m-d H:i:s' );
		$expired_session_retention = min( 90 * DAY_IN_SECONDS, max( 7 * DAY_IN_SECONDS, (int) apply_filters( 'avenra_halo_v2_expired_session_retention', 7 * DAY_IN_SECONDS ) ) );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . esc_sql( $this->table( 'sessions' ) ) . '` WHERE expires_at < %s OR (revoked_at IS NOT NULL AND revoked_at < %s)', gmdate( 'Y-m-d H:i:s', time() - $expired_session_retention ), gmdate( 'Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->query( $wpdb->prepare( "UPDATE `" . esc_sql( $this->table( 'hazards' ) ) . "` SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < %s", $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . esc_sql( $this->table( 'live_tracking' ) ) . '` WHERE expires_at < %s', gmdate( 'Y-m-d H:i:s', time() - 7 * DAY_IN_SECONDS ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( $this->table_exists( $this->table( 'native_ride_sessions' ) ) ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . esc_sql( $this->table( 'native_ride_sessions' ) ) . '` WHERE expires_at < %s', $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
		if ( $this->table_exists( $this->table( 'presence' ) ) ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . esc_sql( $this->table( 'presence' ) ) . '` WHERE last_ping_at < %s', gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
	}
}
