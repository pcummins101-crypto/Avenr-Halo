<?php

defined( 'ABSPATH' ) || exit;

/**
 * Durable Emergency Assist incidents and the private responder dashboard.
 *
 * The service deliberately owns its persistence and never changes the legacy
 * customer or order schemas. Public integrations should use the methods marked
 * public below rather than writing the incident tables directly.
 */
final class Avenra_Halo_V2_Emergency {
	private const COOKIE = '__Host-avenra_halo_v2_emergency';
	private const QUERY_VAR = 'avenra_halo_v2_emergency';
	private const FIRETEXT_ENDPOINT = 'https://www.firetext.co.uk/api/sendsms';
	private const DEFAULT_PRIMARY = '447584557559';
	private const DEFAULT_BACKUP = '447494142606';
	private const CANDIDATE_RETRY_LIMIT = 3;

	private static ?self $instance = null;
	private Avenra_Halo_V2_Database $db;
	private bool $booted = false;

	private function __construct() {
		$this->db = Avenra_Halo_V2_Database::instance();
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

		add_action( 'init', array( $this, 'register_rewrites' ) );
		add_filter( 'query_vars', array( $this, 'query_vars' ) );
		add_action( 'template_redirect', array( $this, 'serve_responder' ), -10 );
		add_action( 'init', array( $this, 'request_time_due_checks' ), 99 );
		add_action( 'avenra_halo_v2_emergency_activate_candidate', array( $this, 'process_scheduled_candidate_activation' ), 10, 2 );
		add_action( 'avenra_halo_v2_emergency_escalate', array( $this, 'process_scheduled_escalation' ) );
		add_action( 'avenra_halo_v2_emergency_enrich', array( $this, 'enrich_incident_address' ) );
		add_action( 'avenra_halo_v2_cleanup', array( $this, 'cleanup' ), 20 );
	}

	public function register_rewrites(): void {
		add_rewrite_rule( '^halo-assist/?$', 'index.php?' . self::QUERY_VAR . '=1', 'top' );
	}

	/** @param string[] $vars @return string[] */
	public function query_vars( array $vars ): array {
		$vars[] = self::QUERY_VAR;
		return array_values( array_unique( $vars ) );
	}

	/** @return array<string,mixed> */
	public function get_assist_settings( int $customer_id ): array {
		global $wpdb;

		$required = $this->required_consent_version();
		$defaults = array(
			'customer_id'             => $customer_id,
			'assist_enabled'          => false,
			'consent_current'         => false,
			'consent_version'         => '',
			'required_consent_version'=> $required,
			'consented_at'            => null,
			'revoked_at'              => null,
			'medical_sharing_enabled' => false,
			'medical_consent_current' => false,
			'medical_consent_version' => '',
			'required_medical_consent_version' => $this->required_medical_consent_version(),
			'medical_consented_at'    => null,
			'medical_revoked_at'      => null,
			'test_ride_monitoring_armed' => false,
			'test_ride_monitoring_active' => false,
			'test_ride_monitoring_stored_armed' => false,
			'test_ride_monitoring_arm_id' => '',
			'test_ride_monitoring_consent_current' => false,
			'test_ride_monitoring_consent_version' => '',
			'required_test_ride_monitoring_consent_version' => $this->required_test_ride_monitoring_consent_version(),
			'test_ride_monitoring_consented_at' => null,
			'test_ride_monitoring_revoked_at' => null,
			'test_ride_monitoring_armed_until' => null,
			'nok_alerts_enabled'      => false,
			'proxy_authority_enabled' => false,
			'law_release_enabled'     => false,
			'research_enabled'        => false,
		);
		if ( $customer_id < 1 || ! $this->db->table_exists( $this->db->table( 'emergency_settings' ) ) ) {
			return array_merge( $defaults, $this->legacy_supplementary_consents( $customer_id ) );
		}

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'emergency_settings' ) ) . '` WHERE customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id
			)
		);
		if ( ! is_object( $row ) ) {
			return array_merge( $defaults, $this->legacy_supplementary_consents( $customer_id ) );
		}

		$enabled = '1' === (string) $row->assist_enabled;
		$version = $this->text( sanitize_text_field( (string) $row->consent_version ), 32 );
		$medical_enabled = '1' === (string) ( $row->medical_sharing_enabled ?? '0' );
		$medical_version = $this->text( sanitize_text_field( (string) ( $row->medical_consent_version ?? '' ) ), 32 );
		$required_medical = $this->required_medical_consent_version();
		$test_ride_stored_armed = '1' === (string) ( $row->test_ride_monitoring_armed ?? '0' );
		$test_ride_arm_id = $this->text( sanitize_text_field( (string) ( $row->test_ride_monitoring_arm_id ?? '' ) ), 64 );
		$test_ride_version = $this->text( sanitize_text_field( (string) ( $row->test_ride_monitoring_consent_version ?? '' ) ), 32 );
		$required_test_ride = $this->required_test_ride_monitoring_consent_version();
		$test_ride_until = $this->rfc3339( $row->test_ride_monitoring_armed_until ?? null );
		$test_ride_until_timestamp = $test_ride_until ? strtotime( $test_ride_until ) : false;
		$test_ride_current = $test_ride_stored_armed
			&& hash_equals( $required_test_ride, $test_ride_version )
			&& false !== $test_ride_until_timestamp
			&& $test_ride_until_timestamp > time();
		$test_ride_active = false;
		$tracking_table = $this->db->table( 'live_tracking' );
		if ( $this->db->table_exists( $tracking_table )
			&& $this->db->has_column( $tracking_table, 'tracking_mode' )
			&& $this->db->has_column( $tracking_table, 'ended_at' )
			&& $this->db->has_column( $tracking_table, 'expires_at' ) ) {
			$test_ride_active = (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM `' . esc_sql( $tracking_table ) . '` WHERE customer_id = %d AND tracking_mode = %s AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id,
					'test_ride',
					current_time( 'mysql', true )
				)
			) > 0;
		}
		$choice_columns = array( 'nok_alerts_enabled', 'proxy_authority_enabled', 'law_release_enabled', 'research_enabled' );
		$legacy_choices = array_fill_keys( $choice_columns, false );
		foreach ( $choice_columns as $choice_column ) {
			if ( ! property_exists( $row, $choice_column ) || null === $row->{$choice_column} ) {
				$legacy_choices = $this->legacy_supplementary_consents( $customer_id );
				break;
			}
		}
		$choice = static function ( object $settings, string $column, array $legacy ): bool {
			if ( property_exists( $settings, $column ) && null !== $settings->{$column} ) {
				return '1' === (string) $settings->{$column};
			}
			return ! empty( $legacy[ $column ] );
		};
		return array(
			'customer_id'             => $customer_id,
			'assist_enabled'          => $enabled,
			'consent_current'         => $enabled && hash_equals( $required, $version ),
			'consent_version'         => $version,
			'required_consent_version'=> $required,
			'consented_at'            => $this->rfc3339( $row->consented_at ?? null ),
			'revoked_at'              => $this->rfc3339( $row->revoked_at ?? null ),
			'medical_sharing_enabled' => $medical_enabled,
			'medical_consent_current' => $medical_enabled && hash_equals( $required_medical, $medical_version ),
			'medical_consent_version' => $medical_version,
			'required_medical_consent_version' => $required_medical,
			'medical_consented_at'    => $this->rfc3339( $row->medical_consented_at ?? null ),
			'medical_revoked_at'      => $this->rfc3339( $row->medical_revoked_at ?? null ),
			'test_ride_monitoring_armed' => $test_ride_current,
			'test_ride_monitoring_active' => $test_ride_active,
			'test_ride_monitoring_stored_armed' => $test_ride_stored_armed,
			'test_ride_monitoring_arm_id' => $test_ride_arm_id,
			'test_ride_monitoring_consent_current' => $test_ride_current,
			'test_ride_monitoring_consent_version' => $test_ride_version,
			'required_test_ride_monitoring_consent_version' => $required_test_ride,
			'test_ride_monitoring_consented_at' => $this->rfc3339( $row->test_ride_monitoring_consented_at ?? null ),
			'test_ride_monitoring_revoked_at' => $this->rfc3339( $row->test_ride_monitoring_revoked_at ?? null ),
			'test_ride_monitoring_armed_until' => $test_ride_until,
			'nok_alerts_enabled'      => $choice( $row, 'nok_alerts_enabled', $legacy_choices ),
			'proxy_authority_enabled' => $choice( $row, 'proxy_authority_enabled', $legacy_choices ),
			'law_release_enabled'     => $choice( $row, 'law_release_enabled', $legacy_choices ),
			'research_enabled'        => $choice( $row, 'research_enabled', $legacy_choices ),
		);
	}

	/**
	 * Read V1 consent fields only while a nullable V2 choice has never been saved.
	 * Installations whose source customer table lacks these optional columns
	 * safely resolve to false without changing that externally owned schema.
	 *
	 * @return array<string,bool>
	 */
	private function legacy_supplementary_consents( int $customer_id ): array {
		$customer = $customer_id > 0 ? $this->db->customer_by_id( $customer_id ) : null;
		return array(
			'nok_alerts_enabled'      => is_object( $customer ) && $this->truthy( $customer->halo_nok_consent ?? false ),
			'proxy_authority_enabled' => is_object( $customer ) && $this->truthy( $customer->halo_proxy ?? false ),
			'law_release_enabled'     => is_object( $customer ) && $this->truthy( $customer->halo_law ?? false ),
			'research_enabled'        => is_object( $customer ) && $this->truthy( $customer->halo_ai ?? false ),
		);
	}

	/** Current Emergency Assist terms identifier required for a new consent. */
	public function required_consent_version(): string {
		try {
			$version = (string) apply_filters( 'avenra_halo_v2_emergency_consent_version', '3' );
		} catch ( Throwable $error ) {
			$version = '3';
		}
		$version = $this->text( sanitize_text_field( trim( $version ) ), 32 );
		return '' !== $version ? $version : '3';
	}

	/** Current optional medical-sharing wording identifier. */
	public function required_medical_consent_version(): string {
		try {
			$version = (string) apply_filters( 'avenra_halo_v2_emergency_medical_consent_version', '1' );
		} catch ( Throwable $error ) {
			$version = '1';
		}
		$version = $this->text( sanitize_text_field( trim( $version ) ), 32 );
		return '' !== $version ? $version : '1';
	}

	/** Current wording identifier for an explicitly armed, one-ride staff monitor. */
	public function required_test_ride_monitoring_consent_version(): string {
		try {
			$version = (string) apply_filters( 'avenra_halo_v2_test_ride_monitoring_consent_version', '1' );
		} catch ( Throwable $error ) {
			$version = '1';
		}
		$version = $this->text( sanitize_text_field( trim( $version ) ), 32 );
		return '' !== $version ? $version : '1';
	}

	public function has_medical_sharing_consent( int $customer_id ): bool {
		return true === $this->get_assist_settings( $customer_id )['medical_consent_current'];
	}

	public function has_assist_consent( int $customer_id ): bool {
		return true === $this->get_assist_settings( $customer_id )['consent_current'];
	}

	public function has_nok_alert_consent( int $customer_id ): bool {
		return true === $this->get_assist_settings( $customer_id )['nok_alerts_enabled'];
	}

	/** Alias intended for REST integrations. */
	public function assist_consent( int $customer_id ): bool {
		return $this->has_assist_consent( $customer_id );
	}

	/**
	 * Store explicit per-customer Emergency Assist consent in plugin-owned data.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public function set_assist_consent( int $customer_id, bool $enabled, string $consent_version = '' ): array|WP_Error {
		global $wpdb;

		if ( $customer_id < 1 || ! $this->db->customer_by_id( $customer_id ) ) {
			return new WP_Error( 'emergency_customer_missing', __( 'The Halo customer could not be found.', 'avenra-halo-v2' ) );
		}
		if ( ! $this->db->table_exists( $this->db->table( 'emergency_settings' ) ) || ! $this->db->table_exists( $this->db->table( 'consent_events' ) ) ) {
			return new WP_Error( 'emergency_storage_unavailable', __( 'Emergency Assist storage is not ready.', 'avenra-halo-v2' ) );
		}

		$lock = $this->db->acquire_advisory_lock( 'emergency-consent', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return new WP_Error( 'emergency_consent_busy', __( 'Emergency Assist consent is already being updated.', 'avenra-halo-v2' ) );
		}
		try {
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM `' . esc_sql( $this->db->table( 'emergency_settings' ) ) . '` WHERE customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id
				)
			);
			$current_enabled = is_object( $row ) && '1' === (string) $row->assist_enabled;
			$current_version = is_object( $row ) ? $this->text( sanitize_text_field( (string) $row->consent_version ), 32 ) : '';
			$required        = $this->required_consent_version();
			$supplied        = $this->text( sanitize_text_field( trim( $consent_version ) ), 32 );

			if ( $enabled && $current_enabled && hash_equals( $required, $current_version ) ) {
				if ( '' !== $supplied && ! hash_equals( $required, $supplied ) ) {
					return $this->consent_version_error( $required );
				}
				if ( ! $this->ensure_consent_audit_state( $customer_id, true, $current_version, (string) ( $row->consented_at ?? '' ) ) ) {
					return new WP_Error( 'emergency_consent_audit_unavailable', __( 'Emergency Assist consent is saved, but its audit record is unavailable.', 'avenra-halo-v2' ) );
				}
				return $this->get_assist_settings( $customer_id );
			}
			if ( ! $enabled && ! $current_enabled ) {
				if ( is_object( $row ) && ! $this->ensure_consent_audit_state( $customer_id, false, $current_version, (string) ( $row->revoked_at ?? '' ) ) ) {
					return new WP_Error( 'emergency_consent_audit_unavailable', __( 'Emergency Assist consent is saved, but its audit record is unavailable.', 'avenra-halo-v2' ) );
				}
				$cleanup = $this->cancel_pending_candidates_after_assist_revocation( $customer_id );
				do_action( 'avenra_halo_v2_emergency_assist_consent_changed', $customer_id, false, $current_version );
				if ( is_wp_error( $cleanup ) ) {
					return $cleanup;
				}
				return $this->get_assist_settings( $customer_id );
			}
			if ( $enabled && ( '' === $supplied || ! hash_equals( $required, $supplied ) ) ) {
				return $this->consent_version_error( $required );
			}

			$now        = current_time( 'mysql', true );
			$event_type = $enabled ? ( $current_enabled ? 'consent_renewed' : 'consent_granted' ) : 'consent_revoked';
			$data       = array(
				'assist_enabled' => $enabled ? 1 : 0,
				'updated_at'     => $now,
			);
			if ( $enabled ) {
				$data['consent_version'] = $required;
				$data['consented_at']    = $now;
				$data['revoked_at']      = null;
			} else {
				$data['revoked_at'] = $now;
			}
			if ( is_object( $row ) ) {
				$saved = $wpdb->update( $this->db->table( 'emergency_settings' ), $data, array( 'customer_id' => $customer_id ) );
			} else {
				$data['customer_id'] = $customer_id;
				$data['created_at']  = $now;
				$saved = $wpdb->insert( $this->db->table( 'emergency_settings' ), $data );
			}
			if ( false === $saved ) {
				return new WP_Error( 'emergency_consent_failed', __( 'Emergency Assist consent could not be saved.', 'avenra-halo-v2' ) );
			}
			$new_version = $enabled ? $required : $current_version;
			$cleanup = $enabled ? true : $this->cancel_pending_candidates_after_assist_revocation( $customer_id );
			if ( ! $this->append_consent_event( $customer_id, $event_type, $current_enabled, $enabled, $current_version, $new_version, $now ) ) {
				return new WP_Error(
					'emergency_consent_audit_unavailable',
					__( 'Emergency Assist consent was saved, but its audit record could not be appended.', 'avenra-halo-v2' ),
					array( 'consent_saved' => true, 'settings' => $this->get_assist_settings( $customer_id ) )
				);
			}
			do_action( 'avenra_halo_v2_emergency_assist_consent_changed', $customer_id, $enabled, $new_version );
			if ( is_wp_error( $cleanup ) ) {
				return $cleanup;
			}
			return $this->get_assist_settings( $customer_id );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	/**
	 * Arm one explicitly consented test ride. The safety REST writer calls this
	 * while holding its transaction, so the setting, audit event and any
	 * revocation of an active monitor commit (or roll back) together.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public function set_test_ride_monitoring_arm( int $customer_id, bool $enabled, string $consent_version = '', string $expected_arm_id = '', string $expected_consented_at = '' ): array|WP_Error {
		global $wpdb;

		if ( $customer_id < 1 || ! $this->db->customer_by_id( $customer_id ) ) {
			return new WP_Error( 'emergency_customer_missing', __( 'The Halo customer could not be found.', 'avenra-halo-v2' ) );
		}

		$settings_table = $this->db->table( 'emergency_settings' );
		$events_table   = $this->db->table( 'consent_events' );
		$tracking_table = $this->db->table( 'live_tracking' );
		$settings_columns = array(
			'test_ride_monitoring_armed',
			'test_ride_monitoring_arm_id',
			'test_ride_monitoring_consent_version',
			'test_ride_monitoring_consented_at',
			'test_ride_monitoring_revoked_at',
			'test_ride_monitoring_armed_until',
		);
		if ( ! $this->db->table_exists( $settings_table ) || ! $this->db->table_exists( $events_table ) || ! $this->db->table_exists( $tracking_table ) ) {
			return new WP_Error( 'test_ride_monitoring_storage_unavailable', __( 'Test-ride monitoring storage is not ready.', 'avenra-halo-v2' ) );
		}
		foreach ( $settings_columns as $column ) {
			if ( ! $this->db->has_column( $settings_table, $column ) ) {
				return new WP_Error( 'test_ride_monitoring_storage_unavailable', __( 'Test-ride monitoring needs the latest Halo database update.', 'avenra-halo-v2' ) );
			}
		}
		foreach ( array( 'tracking_mode', 'arm_id', 'ended_reason' ) as $column ) {
			if ( ! $this->db->has_column( $tracking_table, $column ) ) {
				return new WP_Error( 'test_ride_monitoring_storage_unavailable', __( 'Test-ride monitoring needs the latest Halo database update.', 'avenra-halo-v2' ) );
			}
		}

		$required = $this->required_test_ride_monitoring_consent_version();
		$supplied = $this->text( sanitize_text_field( trim( $consent_version ) ), 32 );
		if ( $enabled && ( '' === $supplied || ! hash_equals( $required, $supplied ) ) ) {
			return new WP_Error(
				'test_ride_monitoring_consent_version_required',
				__( 'Accept the current test-ride monitoring wording before enabling staff monitoring.', 'avenra-halo-v2' ),
				array( 'required_consent_version' => $required )
			);
		}

		$lock = $this->db->acquire_advisory_lock( 'test-ride-monitoring', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return new WP_Error( 'test_ride_monitoring_busy', __( 'Test-ride monitoring is already being updated.', 'avenra-halo-v2' ) );
		}
		try {
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM `' . esc_sql( $settings_table ) . '` WHERE customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id
				)
			);
			$current_enabled = is_object( $row ) && '1' === (string) ( $row->test_ride_monitoring_armed ?? '0' );
			$current_arm_id = is_object( $row ) ? $this->text( sanitize_text_field( (string) ( $row->test_ride_monitoring_arm_id ?? '' ) ), 64 ) : '';
			$current_version = is_object( $row ) ? $this->text( sanitize_text_field( (string) ( $row->test_ride_monitoring_consent_version ?? '' ) ), 32 ) : '';
			// Offline cleanup is conditional on the exact arm the ride claimed. If the
			// rider has since armed a newer test ride on this or another device, a
			// delayed queue item must not withdraw that newer affirmative choice.
			$expected_arm = $this->text( sanitize_text_field( trim( $expected_arm_id ) ), 64 );
			$expected_consent = trim( sanitize_text_field( $expected_consented_at ) );
			$now = current_time( 'mysql', true );
			if ( ! $enabled && '' !== $expected_arm ) {
				if ( '' === $current_arm_id || ! hash_equals( $current_arm_id, $expected_arm ) ) {
					if ( ! $this->end_test_ride_monitoring_rows( $customer_id, $tracking_table, $now, $expected_arm ) ) {
						return new WP_Error( 'test_ride_monitoring_end_failed', __( 'The earlier test-ride monitor could not be stopped.', 'avenra-halo-v2' ) );
					}
					return $this->get_assist_settings( $customer_id );
				}
			} elseif ( ! $enabled && '' !== $expected_consent ) {
				$current_consent = is_object( $row ) ? (string) ( $row->test_ride_monitoring_consented_at ?? '' ) : '';
				$expected_time   = strtotime( $expected_consent );
				$current_consent_time = '' !== $current_consent ? strtotime( $current_consent . ' UTC' ) : false;
				// Timestamp comparison exists only for arms created before opaque IDs.
				// Once the current setting has an ID, a same-second legacy cleanup is
				// never allowed to revoke it; it may close only matching legacy rows.
				if ( '' !== $current_arm_id ) {
					if ( false !== $expected_time ) {
						if ( ! $this->end_test_ride_monitoring_rows( $customer_id, $tracking_table, $now, '', $expected_consent ) ) {
							return new WP_Error( 'test_ride_monitoring_end_failed', __( 'The earlier test-ride monitor could not be stopped.', 'avenra-halo-v2' ) );
						}
					}
					return $this->get_assist_settings( $customer_id );
				}
				if ( false === $expected_time || false === $current_consent_time ) {
					return $this->get_assist_settings( $customer_id );
				}
				if ( $expected_time !== $current_consent_time ) {
					if ( ! $this->end_test_ride_monitoring_rows( $customer_id, $tracking_table, $now, '', $expected_consent ) ) {
						return new WP_Error( 'test_ride_monitoring_end_failed', __( 'The earlier test-ride monitor could not be stopped.', 'avenra-halo-v2' ) );
					}
					return $this->get_assist_settings( $customer_id );
				}
			}
			$data = array(
				'test_ride_monitoring_armed' => $enabled ? 1 : 0,
				'updated_at'                 => $now,
			);
			if ( $enabled ) {
				try {
					$data['test_ride_monitoring_arm_id'] = Avenra_Halo_V2_Auth::random_token( 24 );
				} catch ( Throwable $error ) {
					return new WP_Error( 'test_ride_monitoring_arm_id_failed', __( 'Halo could not create a secure one-ride permission.', 'avenra-halo-v2' ) );
				}
				$data['test_ride_monitoring_consent_version'] = $required;
				$data['test_ride_monitoring_consented_at']    = $now;
				$data['test_ride_monitoring_revoked_at']      = null;
				$data['test_ride_monitoring_armed_until']     = gmdate( 'Y-m-d H:i:s', time() + 2 * HOUR_IN_SECONDS );
			} else {
				$data['test_ride_monitoring_revoked_at']  = $now;
				$data['test_ride_monitoring_armed_until'] = null;
			}

			if ( is_object( $row ) ) {
				$saved = $wpdb->update( $settings_table, $data, array( 'customer_id' => $customer_id ) );
			} else {
				$data['customer_id'] = $customer_id;
				$data['created_at']  = $now;
				$saved = $wpdb->insert( $settings_table, $data );
			}
			if ( false === $saved ) {
				return new WP_Error( 'test_ride_monitoring_save_failed', __( 'The test-ride monitoring choice could not be saved.', 'avenra-halo-v2' ) );
			}

			$new_version = $enabled ? $required : $current_version;
			if ( ( $enabled || $current_enabled ) && ! $this->append_consent_event(
				$customer_id,
				$enabled ? 'test_ride_monitoring_armed' : 'test_ride_monitoring_revoked',
				$current_enabled,
				$enabled,
				$current_version,
				$new_version,
				$now
			) ) {
				return new WP_Error( 'test_ride_monitoring_audit_failed', __( 'The test-ride monitoring choice could not be audited.', 'avenra-halo-v2' ) );
			}

			if ( ! $enabled ) {
				if ( ! $this->end_test_ride_monitoring_rows( $customer_id, $tracking_table, $now, $expected_arm, $expected_consent ) ) {
					return new WP_Error( 'test_ride_monitoring_end_failed', __( 'Active test-ride monitoring could not be stopped.', 'avenra-halo-v2' ) );
				}
			}

			return $this->get_assist_settings( $customer_id );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	/**
	 * End the exact conditional-cleanup scope. Only an explicit disable without
	 * either CAS value may close every active test-ride row for the customer.
	 */
	private function end_test_ride_monitoring_rows( int $customer_id, string $tracking_table, string $ended_at, string $arm_id = '', string $consented_at = '' ): bool {
		global $wpdb;

		$arm_id = $this->text( sanitize_text_field( trim( $arm_id ) ), 64 );
		if ( '' !== $arm_id ) {
			$result = $wpdb->query(
				$wpdb->prepare(
					"UPDATE `" . esc_sql( $tracking_table ) . "` SET ended_at = %s, ended_reason = %s WHERE customer_id = %d AND tracking_mode = %s AND arm_id = %s AND ended_at IS NULL", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$ended_at,
					'conditional_cleanup',
					$customer_id,
					'test_ride',
					$arm_id
				)
			);
			return false !== $result;
		}

		$consented_at = trim( sanitize_text_field( $consented_at ) );
		if ( '' !== $consented_at ) {
			$consented_timestamp = strtotime( $consented_at );
			if ( false === $consented_timestamp ) {
				// A malformed conditional value must never degrade into an unscoped
				// account-wide revoke. Treat it as a successful privacy-preserving no-op.
				return true;
			}
			$result = $wpdb->query(
				$wpdb->prepare(
					"UPDATE `" . esc_sql( $tracking_table ) . "` SET ended_at = %s, ended_reason = %s WHERE customer_id = %d AND tracking_mode = %s AND arm_id IS NULL AND consented_at = %s AND ended_at IS NULL", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$ended_at,
					'conditional_cleanup',
					$customer_id,
					'test_ride',
					gmdate( 'Y-m-d H:i:s', $consented_timestamp )
				)
			);
			return false !== $result;
		}

		$result = $wpdb->query(
			$wpdb->prepare(
				"UPDATE `" . esc_sql( $tracking_table ) . "` SET ended_at = %s, ended_reason = %s WHERE customer_id = %d AND tracking_mode = %s AND ended_at IS NULL", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$ended_at,
				'consent_revoked',
				$customer_id,
				'test_ride'
			)
		);
		return false !== $result;
	}

	/**
	 * Store a separate, explicit and versioned choice for optional health data.
	 * A legacy customer halo_emergency flag is deliberately not imported as
	 * consent: riders must affirm the wording presented by this V2 interface.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public function set_medical_sharing_consent( int $customer_id, bool $enabled, string $consent_version = '' ): array|WP_Error {
		global $wpdb;

		if ( $customer_id < 1 || ! $this->db->customer_by_id( $customer_id ) ) {
			return new WP_Error( 'emergency_customer_missing', __( 'The Halo customer could not be found.', 'avenra-halo-v2' ) );
		}
		if ( ! $this->db->table_exists( $this->db->table( 'emergency_settings' ) ) || ! $this->db->table_exists( $this->db->table( 'consent_events' ) ) ) {
			return new WP_Error( 'emergency_storage_unavailable', __( 'Emergency Assist consent storage is not ready.', 'avenra-halo-v2' ) );
		}

		$assist_lock = $this->db->acquire_advisory_lock( 'emergency-consent', (string) $customer_id, 2 );
		if ( ! $assist_lock ) {
			return new WP_Error( 'emergency_medical_consent_busy', __( 'Medical-information consent is already being updated.', 'avenra-halo-v2' ) );
		}
		$lock = $this->db->acquire_advisory_lock( 'emergency-medical-consent', (string) $customer_id, 2 );
		if ( ! $lock ) {
			$this->db->release_advisory_lock( $assist_lock );
			return new WP_Error( 'emergency_medical_consent_busy', __( 'Medical-information consent is already being updated.', 'avenra-halo-v2' ) );
		}
		try {
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM `' . esc_sql( $this->db->table( 'emergency_settings' ) ) . '` WHERE customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id
				)
			);
			$current_enabled = is_object( $row ) && '1' === (string) ( $row->medical_sharing_enabled ?? '0' );
			$current_version = is_object( $row ) ? $this->text( sanitize_text_field( (string) ( $row->medical_consent_version ?? '' ) ), 32 ) : '';
			$required        = $this->required_medical_consent_version();
			$supplied        = $this->text( sanitize_text_field( trim( $consent_version ) ), 32 );

			if ( $enabled && $current_enabled && hash_equals( $required, $current_version ) ) {
				if ( '' !== $supplied && ! hash_equals( $required, $supplied ) ) {
					return $this->medical_consent_version_error( $required );
				}
				return $this->get_assist_settings( $customer_id );
			}
			if ( ! $enabled && ! $current_enabled ) {
				$redacted = $this->redact_stored_snapshot_sections( $customer_id, true, false );
				if ( is_wp_error( $redacted ) ) {
					return $redacted;
				}
				return $this->get_assist_settings( $customer_id );
			}
			if ( $enabled && ( '' === $supplied || ! hash_equals( $required, $supplied ) ) ) {
				return $this->medical_consent_version_error( $required );
			}

			$now        = current_time( 'mysql', true );
			$event_type = $enabled ? ( $current_enabled ? 'medical_renewed' : 'medical_granted' ) : 'medical_revoked';
			$data       = array(
				'medical_sharing_enabled' => $enabled ? 1 : 0,
				'updated_at'              => $now,
			);
			if ( $enabled ) {
				$data['medical_consent_version'] = $required;
				$data['medical_consented_at']    = $now;
				$data['medical_revoked_at']      = null;
			} else {
				$data['medical_revoked_at'] = $now;
			}
			if ( is_object( $row ) ) {
				$saved = $wpdb->update( $this->db->table( 'emergency_settings' ), $data, array( 'customer_id' => $customer_id ) );
			} else {
				$data['customer_id'] = $customer_id;
				$data['created_at']  = $now;
				$saved = $wpdb->insert( $this->db->table( 'emergency_settings' ), $data );
			}
			if ( false === $saved ) {
				return new WP_Error( 'emergency_medical_consent_failed', __( 'Medical-information consent could not be saved.', 'avenra-halo-v2' ) );
			}
			$new_version = $enabled ? $required : $current_version;
			$redacted = $enabled ? true : $this->redact_stored_snapshot_sections( $customer_id, true, false );
			if ( ! $this->append_consent_event( $customer_id, $event_type, $current_enabled, $enabled, $current_version, $new_version, $now ) ) {
				return new WP_Error(
					'emergency_medical_consent_audit_unavailable',
					__( 'Medical-information consent was saved, but its audit record could not be appended.', 'avenra-halo-v2' ),
					array( 'consent_saved' => true, 'settings' => $this->get_assist_settings( $customer_id ) )
				);
			}
			if ( is_wp_error( $redacted ) ) {
				return $redacted;
			}
			return $this->get_assist_settings( $customer_id );
		} finally {
			$this->db->release_advisory_lock( $lock );
			$this->db->release_advisory_lock( $assist_lock );
		}
	}

	private function consent_version_error( string $required ): WP_Error {
		return new WP_Error(
			'emergency_consent_version_required',
			__( 'Accept the current Emergency Assist terms before enabling this service.', 'avenra-halo-v2' ),
			array( 'required_consent_version' => $required )
		);
	}

	private function medical_consent_version_error( string $required ): WP_Error {
		return new WP_Error(
			'emergency_medical_consent_version_required',
			__( 'Accept the current optional medical-information wording before sharing health data.', 'avenra-halo-v2' ),
			array( 'required_medical_consent_version' => $required )
		);
	}

	private function ensure_consent_audit_state( int $customer_id, bool $enabled, string $version, string $effective_at ): bool {
		global $wpdb;

		$effective_at = preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $effective_at ) ? $effective_at : current_time( 'mysql', true );
		$exists = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM `" . esc_sql( $this->db->table( 'consent_events' ) ) . "` WHERE customer_id = %d AND event_type IN ('consent_granted','consent_renewed','consent_revoked','consent_state_imported') AND new_enabled = %d AND new_version = %s AND occurred_at = %s ORDER BY id DESC LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id,
				$enabled ? 1 : 0,
				$version,
				$effective_at
			)
		);
		if ( $exists > 0 ) {
			return true;
		}
		return $this->append_consent_event( $customer_id, 'consent_state_imported', $enabled, $enabled, $version, $version, $effective_at );
	}

	private function append_consent_event( int $customer_id, string $event_type, bool $previous_enabled, bool $new_enabled, string $previous_version, string $new_version, string $occurred_at ): bool {
		global $wpdb;

		return false !== $wpdb->insert(
			$this->db->table( 'consent_events' ),
			array(
				'customer_id'      => $customer_id,
				'event_type'       => $this->text( sanitize_key( $event_type ), 32 ),
				'previous_enabled' => $previous_enabled ? 1 : 0,
				'new_enabled'      => $new_enabled ? 1 : 0,
				'previous_version' => $this->text( sanitize_text_field( $previous_version ), 32 ),
				'new_version'      => $this->text( sanitize_text_field( $new_version ), 32 ),
				'occurred_at'      => $occurred_at,
			)
		);
	}

	/**
	 * Acquire the privacy locks used by every incident-snapshot writer.
	 *
	 * Lock order is deliberately stable: safety/NOK, Assist, medical, then the
	 * event or incident lock owned by the caller. Consent setters either run
	 * under the outer safety lock or acquire only a suffix of this order.
	 *
	 * @return array<string,string>|WP_Error
	 */
	private function acquire_snapshot_consent_locks( int $customer_id ): array|WP_Error {
		$locks = array();
		$definitions = array(
			'safety'  => array( 'emergency-safety-consent', 'emergency_safety_consent_busy', __( 'Safety information is already being updated.', 'avenra-halo-v2' ) ),
			'assist'  => array( 'emergency-consent', 'emergency_consent_busy', __( 'Emergency Assist consent is already being updated.', 'avenra-halo-v2' ) ),
			'medical' => array( 'emergency-medical-consent', 'emergency_medical_consent_busy', __( 'Medical-information consent is already being updated.', 'avenra-halo-v2' ) ),
		);
		foreach ( $definitions as $key => $definition ) {
			$lock = $this->db->acquire_advisory_lock( $definition[0], (string) $customer_id, 2 );
			if ( ! $lock ) {
				$this->release_snapshot_consent_locks( $locks );
				return new WP_Error( $definition[1], $definition[2] );
			}
			$locks[ $key ] = $lock;
		}
		return $locks;
	}

	/** @param array<string,string> $locks */
	private function release_snapshot_consent_locks( array $locks ): void {
		foreach ( array_reverse( $locks ) as $lock ) {
			$this->db->release_advisory_lock( $lock );
		}
	}

	/** @return bool|WP_Error */
	private function cancel_pending_candidates_after_assist_revocation( int $customer_id ): bool|WP_Error {
		global $wpdb;

		$event_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT client_event_id FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE customer_id = %d AND status = 'candidate' ORDER BY id ASC", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id
			)
		);
		foreach ( is_array( $event_ids ) ? $event_ids : array() as $event_id ) {
			$cancelled = $this->cancel_incident( $customer_id, (string) $event_id, 'consent_revoked' );
			if ( is_wp_error( $cancelled ) ) {
				return new WP_Error(
					'emergency_consent_candidate_cleanup_failed',
					__( 'Emergency Assist was disabled, but a pending incident still needs secure cancellation. Please retry.', 'avenra-halo-v2' ),
					array( 'consent_saved' => true, 'retryable' => true )
				);
			}
		}

		$remaining = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE customer_id = %d AND status = 'candidate'", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id
			)
		);
		return $remaining > 0
			? new WP_Error( 'emergency_consent_candidate_cleanup_failed', __( 'Emergency Assist was disabled, but a pending incident still needs secure cancellation. Please retry.', 'avenra-halo-v2' ), array( 'consent_saved' => true, 'retryable' => true ) )
			: true;
	}

	/**
	 * Remove consent-bound fields from every retained snapshot. The caller must
	 * hold the relevant consent lock for the entire scan.
	 *
	 * @return bool|WP_Error
	 */
	private function redact_stored_snapshot_sections( int $customer_id, bool $medical, bool $next_of_kin ): bool|WP_Error {
		global $wpdb;

		if ( ! $medical && ! $next_of_kin ) {
			return true;
		}
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				' SELECT id FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE customer_id = %d AND snapshot_ciphertext IS NOT NULL AND snapshot_redacted_at IS NULL ORDER BY id ASC', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id
			)
		);
		foreach ( is_array( $ids ) ? $ids : array() as $incident_id ) {
			$lock = $this->db->acquire_advisory_lock( 'emergency-incident-id', (string) absint( $incident_id ), 2 );
			if ( ! $lock ) {
				return new WP_Error( 'emergency_consent_snapshot_busy', __( 'A retained incident is still being updated. Please retry the privacy change.', 'avenra-halo-v2' ), array( 'retryable' => true ) );
			}
			try {
				$incident = $this->incident_by_id( absint( $incident_id ) );
				if ( ! $incident || (int) $incident->customer_id !== $customer_id || empty( $incident->snapshot_ciphertext ) || ! empty( $incident->snapshot_redacted_at ) ) {
					continue;
				}
				$snapshot = $this->snapshot_for_incident( $incident );
				if ( empty( $snapshot ) ) {
					return new WP_Error( 'emergency_snapshot_unavailable', __( 'A protected incident snapshot could not be opened for privacy redaction.', 'avenra-halo-v2' ), array( 'retryable' => true ) );
				}
				if ( $medical ) {
					$snapshot['medical'] = array();
					if ( is_array( $snapshot['consents'] ?? null ) ) {
						$snapshot['consents']['medical'] = false;
					}
				}
				if ( $next_of_kin ) {
					$snapshot['next_of_kin'] = array();
					if ( is_array( $snapshot['consents'] ?? null ) ) {
						$snapshot['consents']['next_of_kin'] = false;
					}
				}
				$ciphertext = $this->encrypt_value( $snapshot, $this->snapshot_aad( $customer_id, (string) $incident->client_event_id ) );
				if ( is_wp_error( $ciphertext ) ) {
					return $ciphertext;
				}
				$saved = $wpdb->update(
					$this->db->table( 'incidents' ),
					array( 'snapshot_ciphertext' => $ciphertext, 'updated_at' => current_time( 'mysql', true ) ),
					array( 'id' => (int) $incident->id )
				);
				if ( false === $saved ) {
					return new WP_Error( 'emergency_consent_snapshot_redaction_failed', __( 'A retained incident could not be updated for this privacy change.', 'avenra-halo-v2' ), array( 'retryable' => true ) );
				}
				$this->append_event( (int) $incident->id, 'snapshot_consent_redacted', 'system', array( 'medical' => $medical, 'next_of_kin' => $next_of_kin ) );
			} finally {
				$this->db->release_advisory_lock( $lock );
			}
		}
		return true;
	}

	/**
	 * Called by the safety controller while it holds emergency-safety-consent.
	 *
	 * @return bool|WP_Error
	 */
	public function redact_next_of_kin_snapshots_after_revocation( int $customer_id ): bool|WP_Error {
		return $this->redact_stored_snapshot_sections( $customer_id, false, true );
	}

	/** @return bool|WP_Error */
	private function cancel_candidate_under_incident_lock( object $incident, string $reason ): bool|WP_Error {
		global $wpdb;

		$media_lock = $this->db->acquire_advisory_lock( 'incident-media-upload', (string) $incident->id, 2 );
		if ( ! $media_lock ) {
			return new WP_Error( 'emergency_cancel_media_busy', __( 'Incident evidence is being secured. Retry the cancellation immediately.', 'avenra-halo-v2' ), array( 'retryable' => true ) );
		}
		$now = current_time( 'mysql', true );
		try {
			$updated = $wpdb->update(
				$this->db->table( 'incidents' ),
				array(
					'status'               => 'cancelled',
					'activation_due_at'    => null,
					'resolved_at'           => $now,
					'snapshot_ciphertext'   => null,
					'snapshot_redacted_at'  => $now,
					'updated_at'            => $now,
				),
				array( 'id' => (int) $incident->id, 'status' => 'candidate' )
			);
			if ( 1 === (int) $updated && class_exists( 'Avenra_Halo_V2_Incident_Media' ) ) {
				Avenra_Halo_V2_Incident_Media::instance()->purge_incident_under_upload_lock( (int) $incident->id, 'cancelled' );
			}
		} finally {
			$this->db->release_advisory_lock( $media_lock );
		}
		if ( false === $updated ) {
			return new WP_Error( 'emergency_cancel_failed', __( 'The pending Emergency Assist incident could not be cancelled safely.', 'avenra-halo-v2' ) );
		}
		if ( 0 === $updated ) {
			$current = $this->incident_by_id( (int) $incident->id );
			return $current && 'cancelled' === (string) $current->status
				? true
				: new WP_Error( 'emergency_cancel_failed', __( 'The pending Emergency Assist incident could not be cancelled safely.', 'avenra-halo-v2' ) );
		}
		if ( 1 === $updated ) {
			$this->clear_candidate_activation( (int) $incident->id );
			$this->append_event( (int) $incident->id, 'cancellation', 'system', array( 'reason' => sanitize_key( $reason ), 'preemptive' => false ) );
		}
		return true;
	}

	/**
	 * Persist a crash candidate without contacting a responder.
	 *
	 * @param array<string,mixed> $input
	 * @return array<string,mixed>|WP_Error
	 */
	public function record_candidate( int $customer_id, string $client_event_id, array $input, string $source = 'automatic' ): array|WP_Error {
		global $wpdb;

		$client_event_id = sanitize_text_field( $client_event_id );
		if ( $customer_id < 1 || ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $client_event_id ) ) {
			return new WP_Error( 'emergency_event_invalid', __( 'A stable Emergency Assist event identifier is required.', 'avenra-halo-v2' ) );
		}
		if ( ! $this->storage_ready() ) {
			return new WP_Error( 'emergency_storage_unavailable', __( 'Emergency Assist storage is not ready.', 'avenra-halo-v2' ) );
		}
		$consent_locks = $this->acquire_snapshot_consent_locks( $customer_id );
		if ( is_wp_error( $consent_locks ) ) {
			return $consent_locks;
		}
		try {
			// The preflight REST check is advisory. This recheck is the durable
			// boundary that prevents a post-revocation candidate or snapshot.
			if ( ! $this->has_assist_consent( $customer_id ) ) {
				return new WP_Error( 'emergency_consent_required', __( 'Emergency Assist must be enabled under the current terms before an incident can be recorded.', 'avenra-halo-v2' ) );
			}

			$lock = $this->db->acquire_advisory_lock( 'emergency-incident', $customer_id . '|' . $client_event_id, 2 );
			if ( ! $lock ) {
				return new WP_Error( 'emergency_incident_busy', __( 'Emergency Assist is already processing this incident.', 'avenra-halo-v2' ) );
			}

			try {
			$existing = $this->incident_by_event( $customer_id, $client_event_id );
			if ( $existing ) {
				$response               = $this->incident_response( $existing );
				$response['idempotent'] = true;
				return $response;
			}

			$source = in_array( sanitize_key( $source ), array( 'automatic', 'manual', 'test', 'simulation' ), true ) ? sanitize_key( $source ) : 'automatic';
			$is_test = in_array( $source, array( 'test', 'simulation' ), true );
			$test_mode = 'simulation' === $source ? 'dry_run' : ( 'test' === $source ? 'live_sms' : null );
			$scenario = $is_test ? sanitize_key( (string) ( $input['test_scenario'] ?? 'happy_path' ) ) : '';
			$scenario = in_array( $scenario, array( 'happy_path', 'primary_rejected', 'primary_timeout', 'no_ack_fallback' ), true ) ? $scenario : 'happy_path';
			$snapshot = $this->build_snapshot( $customer_id, $client_event_id, $input );
			if ( is_wp_error( $snapshot ) ) {
				return $snapshot;
			}
			$ciphertext = $this->encrypt_value( $snapshot, $this->snapshot_aad( $customer_id, $client_event_id ) );
			if ( is_wp_error( $ciphertext ) ) {
				return $ciphertext;
			}

			$occurred_at   = $this->mysql_time( $input['occurred_at'] ?? $input['detected_at'] ?? $input['queued_at'] ?? null );
			$client_ride_id = $this->text( sanitize_text_field( (string) ( $input['client_ride_id'] ?? $input['ride_id'] ?? '' ) ), 80 );
			$now           = current_time( 'mysql', true );
			$activation_at = time() + $this->cancellation_delay();
			$inserted    = $wpdb->insert(
				$this->db->table( 'incidents' ),
				array(
					'public_id'           => wp_generate_uuid4(),
					'customer_id'         => $customer_id,
					'client_event_id'     => $client_event_id,
					'client_ride_id'      => '' !== $client_ride_id ? $client_ride_id : null,
					'source'              => $source,
					'is_test'             => $is_test ? 1 : 0,
					'test_dispatch_mode'  => $test_mode,
					'test_scenario'       => $is_test ? $scenario : null,
					'status'              => 'candidate',
					'occurred_at'         => $occurred_at,
					'activation_due_at'   => gmdate( 'Y-m-d H:i:s', $activation_at ),
					'snapshot_ciphertext' => $ciphertext,
					'created_at'          => $now,
					'updated_at'          => $now,
				)
			);
			if ( false === $inserted ) {
				$existing = $this->incident_by_event( $customer_id, $client_event_id );
				return $existing ? $this->incident_response( $existing ) : new WP_Error( 'emergency_incident_failed', __( 'The Emergency Assist incident could not be recorded.', 'avenra-halo-v2' ) );
			}

			$incident_id = (int) $wpdb->insert_id;
			$this->append_event(
				$incident_id,
				$is_test ? 'test_candidate' : 'candidate',
				$is_test ? 'operator' : 'rider',
				array( 'source' => $source, 'dispatch_mode' => $test_mode, 'scenario' => $is_test ? $scenario : '' )
			);
			// The browser normally activates at the end of the visible countdown.
			// This durable server job closes the safety gap if the tab, browser or
			// network request disappears after the candidate has been committed.
			$this->schedule_background( 'avenra_halo_v2_emergency_activate_candidate', $incident_id, $activation_at );
			$incident = $this->incident_by_id( $incident_id );
			return $incident ? $this->incident_response( $incident ) : new WP_Error( 'emergency_incident_failed', __( 'The Emergency Assist incident could not be refreshed.', 'avenra-halo-v2' ) );
			} finally {
				$this->db->release_advisory_lock( $lock );
			}
		} finally {
			$this->release_snapshot_consent_locks( $consent_locks );
		}
	}

	/**
	 * Activate an incident and attempt the primary responder SMS inline.
	 *
	 * @param array<string,mixed> $input
	 * @return array<string,mixed>|WP_Error
	 */
	public function activate_incident( int $customer_id, string $client_event_id, array $input = array(), string $source = 'automatic' ): array|WP_Error {
		$candidate = $this->record_candidate( $customer_id, $client_event_id, $input, $source );
		if ( is_wp_error( $candidate ) ) {
			return $candidate;
		}

		$incident = $this->incident_by_event( $customer_id, $client_event_id );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
		}
		if ( 'cancelled' === (string) $incident->status ) {
			return new WP_Error( 'emergency_incident_cancelled', __( 'This Emergency Assist incident was cancelled.', 'avenra-halo-v2' ) );
		}
		if ( 'candidate' !== (string) $incident->status ) {
			$this->clear_candidate_activation( (int) $incident->id );
			$response               = $this->incident_response( $incident );
			$response['idempotent'] = true;
			return $response;
		}

		// A candidate can be recorded before the final sensor/GPS sample arrives.
		// Merge the activation payload under the same lock that makes dispatch
		// irreversible, so the responder always sees the richest pre-send snapshot.
		$prepared = $this->prepare_primary_attempt( $incident, $input );
		if ( is_wp_error( $prepared ) ) {
			return $prepared;
		}
		if ( empty( $prepared['token'] ) ) {
			$this->clear_candidate_activation( (int) $incident->id );
			$current                = $this->incident_by_id( (int) $incident->id );
			$response               = $current ? $this->incident_response( $current ) : $candidate;
			$response['idempotent'] = true;
			return $response;
		}

		$incident = $this->incident_by_id( (int) $incident->id );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be refreshed.', 'avenra-halo-v2' ) );
		}
		$this->clear_candidate_activation( (int) $incident->id );
		$this->append_event( (int) $incident->id, 'activation', 'system', array( 'delay_seconds' => $this->cancellation_delay() ) );
		$this->append_event( (int) $incident->id, 'provider_attempt', 'primary', array( 'provider' => $this->dispatch_provider_label( $incident ) ) );

		$result    = $this->deliver_responder_sms( $incident, 'primary', (string) $prepared['token'] );
		$persisted = $this->record_provider_result( (int) $incident->id, 'primary', $result );
		if ( is_wp_error( $persisted ) ) {
			// The provider may have accepted the first request even though its
			// outcome could not be durably recorded. Contact the independent
			// backup now; duplicate human awareness is safer than silent loss.
			$fallback = $this->escalate_backup( (int) $incident->id );
			if ( is_array( $fallback ) && ! empty( $fallback['accepted'] ) ) {
				return $fallback;
			}
			return $persisted;
		}
		// Any result other than an explicit provider acceptance is insufficient
		// for a safety escalation. Attempt backup immediately; the 15-second wait
		// is reserved for an accepted primary SMS awaiting acknowledgement.
		if ( 'accepted' !== $result['state'] ) {
			$fallback = $this->escalate_backup( (int) $incident->id );
			if ( is_wp_error( $fallback ) ) {
				return $fallback;
			}
		} else {
			$this->schedule_escalation( (int) $incident->id, strtotime( (string) $incident->escalation_due_at . ' UTC' ) ?: time() + $this->backup_delay() );
		}
		if ( 'accepted' === $result['state'] ) {
			$this->schedule_background( 'avenra_halo_v2_emergency_enrich', (int) $incident->id, time() + 1 );
		}

		$current = $this->incident_by_id( (int) $incident->id );
		return $current ? $this->incident_response( $current ) : new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be refreshed.', 'avenra-halo-v2' ) );
	}

	/** Backwards-friendly concise alias for the REST controller. */
	public function activate( int $customer_id, string $client_event_id, array $snapshot = array(), string $source = 'automatic' ): array|WP_Error {
		return $this->activate_incident( $customer_id, $client_event_id, $snapshot, $source );
	}

	/** @return array<string,mixed>|WP_Error */
	public function cancel_incident( int $customer_id, string $client_event_id, string $reason = 'rider_cancelled' ): array|WP_Error {
		global $wpdb;

		$client_event_id = sanitize_text_field( $client_event_id );
		$reason          = sanitize_key( $reason );
		if ( $customer_id < 1 || ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $client_event_id ) ) {
			return new WP_Error( 'emergency_event_invalid', __( 'A stable Emergency Assist event identifier is required.', 'avenra-halo-v2' ) );
		}
		if ( ! $this->storage_ready() ) {
			return new WP_Error( 'emergency_storage_unavailable', __( 'Emergency Assist storage is not ready.', 'avenra-halo-v2' ) );
		}

		// Cancellation and candidate creation share this customer/event lock. If the
		// rider cancels before the candidate INSERT reaches PHP, a minimal durable
		// cancelled row becomes the tombstone that the later candidate request sees.
		$event_lock = $this->db->acquire_advisory_lock( 'emergency-incident', $customer_id . '|' . $client_event_id, 2 );
		if ( ! $event_lock ) {
			return new WP_Error( 'emergency_incident_busy', __( 'Emergency Assist is already processing this incident.', 'avenra-halo-v2' ) );
		}
		try {
			$incident = $this->incident_by_event( $customer_id, $client_event_id );
			if ( ! $incident ) {
				$now      = current_time( 'mysql', true );
				$inserted = $wpdb->insert(
					$this->db->table( 'incidents' ),
					array(
						'public_id'          => wp_generate_uuid4(),
						'customer_id'        => $customer_id,
						'client_event_id'    => $client_event_id,
						'source'             => 'automatic',
						'is_test'            => 0,
						'status'             => 'cancelled',
						'occurred_at'        => $now,
						'activation_due_at'  => null,
						'snapshot_ciphertext'=> null,
						'snapshot_redacted_at'=> $now,
						'resolved_at'         => $now,
						'created_at'          => $now,
						'updated_at'          => $now,
					)
				);
				if ( false === $inserted ) {
					// A uniqueness race can only be safe if its winner is now visible.
					$incident = $this->incident_by_event( $customer_id, $client_event_id );
					if ( ! $incident ) {
						return new WP_Error( 'emergency_cancel_failed', __( 'The Emergency Assist cancellation could not be protected.', 'avenra-halo-v2' ) );
					}
				} else {
					$incident = $this->incident_by_id( (int) $wpdb->insert_id );
					if ( ! $incident ) {
						return new WP_Error( 'emergency_incident_missing', __( 'The protected Emergency Assist cancellation could not be refreshed.', 'avenra-halo-v2' ) );
					}
					$this->append_event( (int) $incident->id, 'cancellation', 'rider', array( 'reason' => $reason, 'preemptive' => true ) );
					$response               = $this->incident_response( $incident );
					$response['preemptive'] = true;
					return $response;
				}
			}

			if ( 'cancelled' === (string) $incident->status ) {
				$response               = $this->incident_response( $incident );
				$response['idempotent'] = true;
				return $response;
			}
			$lock = $this->db->acquire_advisory_lock( 'emergency-incident-id', (string) $incident->id, 2 );
			if ( ! $lock ) {
				return new WP_Error( 'emergency_incident_busy', __( 'Emergency Assist is already processing this incident.', 'avenra-halo-v2' ) );
			}
			try {
				$incident = $this->incident_by_id( (int) $incident->id );
				if ( ! $incident ) {
					return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
				}
				if ( 'cancelled' === (string) $incident->status ) {
					$response               = $this->incident_response( $incident );
					$response['idempotent'] = true;
					return $response;
				}
				if ( 'candidate' !== (string) $incident->status ) {
					return new WP_Error(
						'emergency_cancellation_closed',
						__( 'This incident has already been activated and can no longer be cancelled from the rider device.', 'avenra-halo-v2' )
					);
				}
				$media_lock = $this->db->acquire_advisory_lock( 'incident-media-upload', (string) $incident->id, 2 );
				if ( ! $media_lock ) {
					return new WP_Error( 'emergency_cancel_media_busy', __( 'Incident evidence is being secured. Retry the cancellation immediately.', 'avenra-halo-v2' ), array( 'retryable' => true ) );
				}
				$now = current_time( 'mysql', true );
				try {
					$updated = $wpdb->update(
						$this->db->table( 'incidents' ),
						array(
							'status'                => 'cancelled',
							'activation_due_at'     => null,
							'resolved_at'            => $now,
							'snapshot_ciphertext'    => null,
							'snapshot_redacted_at'   => $now,
							'updated_at'             => $now,
						),
						array( 'id' => (int) $incident->id, 'status' => 'candidate' )
					);
					if ( 1 === (int) $updated && class_exists( 'Avenra_Halo_V2_Incident_Media' ) ) {
						Avenra_Halo_V2_Incident_Media::instance()->purge_incident_under_upload_lock( (int) $incident->id, 'cancelled' );
					}
				} finally {
					$this->db->release_advisory_lock( $media_lock );
				}
				if ( false === $updated ) {
					return new WP_Error( 'emergency_cancel_failed', __( 'The Emergency Assist incident could not be cancelled.', 'avenra-halo-v2' ) );
				}
				if ( 0 === $updated ) {
					return new WP_Error( 'emergency_cancellation_closed', __( 'This incident has already been activated and can no longer be cancelled from the rider device.', 'avenra-halo-v2' ) );
				}
				$this->clear_candidate_activation( (int) $incident->id );
				$this->append_event( (int) $incident->id, 'cancellation', 'rider', array( 'reason' => $reason, 'preemptive' => false ) );
				$current = $this->incident_by_id( (int) $incident->id );
				return $current ? $this->incident_response( $current ) : new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be refreshed.', 'avenra-halo-v2' ) );
			} finally {
				$this->db->release_advisory_lock( $lock );
			}
		} finally {
			$this->db->release_advisory_lock( $event_lock );
		}
	}

	/** REST alias. */
	public function cancel( int $customer_id, string $client_event_id, string $reason = 'rider_cancelled' ): array|WP_Error {
		return $this->cancel_incident( $customer_id, $client_event_id, $reason );
	}

	/**
	 * Merge a fresh on-device position/route/telemetry sample into an activated
	 * incident. The overdue-backup check runs after the protected write, making
	 * this safe for the rider's 15-second request-time fallback.
	 *
	 * @param array<string,mixed> $input
	 * @return array<string,mixed>|WP_Error
	 */
	public function update_incident_position( int $customer_id, string $client_event_id, array $input ): array|WP_Error {
		global $wpdb;

		$client_event_id = sanitize_text_field( $client_event_id );
		if ( $customer_id < 1 || ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $client_event_id ) ) {
			return new WP_Error( 'emergency_event_invalid', __( 'A stable Emergency Assist event identifier is required.', 'avenra-halo-v2' ) );
		}
		$incident = $this->incident_by_event( $customer_id, $client_event_id );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
		}
		$consent_locks = $this->acquire_snapshot_consent_locks( $customer_id );
		if ( is_wp_error( $consent_locks ) ) {
			return $consent_locks;
		}
		try {
			$lock = $this->db->acquire_advisory_lock( 'emergency-incident-id', (string) $incident->id, 2 );
			if ( ! $lock ) {
				return new WP_Error( 'emergency_incident_busy', __( 'Emergency Assist is already processing this incident.', 'avenra-halo-v2' ) );
			}
			try {
				$incident = $this->incident_by_id( (int) $incident->id );
				if ( ! $incident ) {
					return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
				}
				if ( ! in_array( (string) $incident->status, array( 'active', 'acknowledged' ), true ) ) {
					return new WP_Error( 'emergency_incident_not_active', __( 'Only an active Emergency Assist incident can receive position updates.', 'avenra-halo-v2' ) );
				}
				$ciphertext = $this->merged_snapshot_ciphertext( $incident, $input );
				if ( is_wp_error( $ciphertext ) ) {
					return $ciphertext;
				}
				$saved = $wpdb->update(
					$this->db->table( 'incidents' ),
					array( 'snapshot_ciphertext' => $ciphertext, 'updated_at' => current_time( 'mysql', true ) ),
					array( 'id' => (int) $incident->id )
				);
				if ( false === $saved ) {
					return new WP_Error( 'emergency_position_failed', __( 'The latest Emergency Assist position could not be protected.', 'avenra-halo-v2' ) );
				}
			} finally {
				$this->db->release_advisory_lock( $lock );
			}
		} finally {
			$this->release_snapshot_consent_locks( $consent_locks );
		}

		// This is deliberately outside the incident lock: escalation owns a
		// separate advisory lock and may perform a bounded network request.
		$current = $this->incident_by_event( $customer_id, $client_event_id );
		if ( $current && ( 'accepted' === (string) $current->primary_status || 'accepted' === (string) $current->backup_status ) && $this->input_has_location( $input ) ) {
			$this->schedule_background( 'avenra_halo_v2_emergency_enrich', (int) $current->id, time() + 1 );
		}
		return $this->process_due_escalation( $customer_id, $client_event_id );
	}

	/** REST-friendly alias. */
	public function update_position( int $customer_id, string $client_event_id, array $input ): array|WP_Error {
		return $this->update_incident_position( $customer_id, $client_event_id, $input );
	}

	/**
	 * Run the backup due check for one authenticated rider incident.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public function process_due_escalation( int $customer_id, string $client_event_id ): array|WP_Error {
		$incident = $this->incident_by_event( $customer_id, sanitize_text_field( $client_event_id ) );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
		}
		$due = '' !== (string) ( $incident->escalation_due_at ?? '' ) ? strtotime( (string) $incident->escalation_due_at . ' UTC' ) : false;
		if (
			'pending' === (string) $incident->backup_status
			&& null === $incident->first_acknowledged_at
			&& in_array( (string) $incident->status, array( 'active', 'acknowledged' ), true )
			&& false !== $due
			&& $due <= time()
		) {
			return $this->escalate_backup( (int) $incident->id );
		}
		$response               = $this->incident_response( $incident );
		$response['idempotent'] = true;
		return $response;
	}

	/** @return array<string,mixed>|null */
	public function get_incident_status( int $customer_id, string $client_event_id ): ?array {
		$incident = $this->incident_by_event( $customer_id, sanitize_text_field( $client_event_id ) );
		return $incident ? $this->incident_response( $incident ) : null;
	}

	/**
	 * Rich incident data for the authenticated WordPress operations console.
	 * Bearer/session hashes and ciphertext are never returned. Medical data has
	 * its own capability so roster access does not silently grant health access.
	 *
	 * @return array<string,mixed>|WP_Error
	 */
	public function operator_incident_briefing( string $public_id, int $wp_user_id ): array|WP_Error {
		global $wpdb;

		if ( $wp_user_id < 1 || get_current_user_id() !== $wp_user_id || ! user_can( $wp_user_id, 'avenra_halo_emergency_view' ) ) {
			return new WP_Error( 'operations_forbidden', __( 'You are not authorised to view Emergency Assist incidents.', 'avenra-halo-v2' ) );
		}
		$incident = $this->incident_by_public_id( sanitize_text_field( $public_id ) );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
		}
		$snapshot = $this->redact_snapshot_for_current_consent( $this->snapshot_for_incident( $incident ), (int) $incident->customer_id );
		if ( ! user_can( $wp_user_id, 'avenra_halo_emergency_medical' ) ) {
			$snapshot['medical'] = array();
		}
		$events = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT event_type, actor_role, metadata_json, created_at FROM `' . esc_sql( $this->db->table( 'incident_events' ) ) . '` WHERE incident_id = %d ORDER BY created_at ASC, id ASC', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				(int) $incident->id
			),
			ARRAY_A
		);
		$events = is_array( $events ) ? $events : array();
		foreach ( $events as &$event ) {
			$metadata = json_decode( (string) ( $event['metadata_json'] ?? '' ), true );
			$event['metadata'] = is_array( $metadata ) ? $metadata : array();
			unset( $event['metadata_json'] );
			$event['created_at'] = $this->rfc3339( $event['created_at'] ?? null );
		}
		unset( $event );
		$acknowledger = '';
		if ( ! empty( $incident->acknowledger_ciphertext ) ) {
			$opened = $this->decrypt_value( (string) $incident->acknowledger_ciphertext, 'acknowledger|' . (int) $incident->id );
			$acknowledger = is_array( $opened ) ? sanitize_text_field( (string) ( $opened['name'] ?? '' ) ) : '';
		}

		return array(
			'incident' => array(
				'id'                           => sanitize_text_field( (string) $incident->public_id ),
				'customer_id'                  => (int) $incident->customer_id,
				'event_id'                     => sanitize_text_field( (string) $incident->client_event_id ),
				'source'                       => sanitize_key( (string) $incident->source ),
				'is_test'                      => $this->is_test_incident( $incident ),
				'test_dispatch_mode'           => sanitize_key( (string) ( $incident->test_dispatch_mode ?? '' ) ),
				'test_scenario'                => sanitize_key( (string) ( $incident->test_scenario ?? '' ) ),
				'status'                       => sanitize_key( (string) $incident->status ),
				'occurred_at'                  => $this->rfc3339( $incident->occurred_at ?? null ),
				'activated_at'                 => $this->rfc3339( $incident->activated_at ?? null ),
				'primary_status'               => sanitize_key( (string) $incident->primary_status ),
				'primary_sent_at'              => $this->rfc3339( $incident->primary_sent_at ?? null ),
				'backup_status'                => sanitize_key( (string) $incident->backup_status ),
				'backup_sent_at'               => $this->rfc3339( $incident->backup_sent_at ?? null ),
				'first_acknowledged_at'        => $this->rfc3339( $incident->first_acknowledged_at ?? null ),
				'first_acknowledged_by'        => sanitize_key( (string) ( $incident->first_acknowledged_by ?? '' ) ),
				'acknowledger_name'            => $acknowledger,
				'rider_call_result'            => sanitize_key( (string) ( $incident->rider_call_result ?? '' ) ),
				'emergency_services_called_at' => $this->rfc3339( $incident->emergency_services_called_at ?? null ),
				'nok_notification_status'      => sanitize_key( (string) ( $incident->nok_notification_status ?? '' ) ),
				'resolved_at'                  => $this->rfc3339( $incident->resolved_at ?? null ),
			),
			'snapshot'       => $snapshot,
			'snapshot_unavailable' => empty( $snapshot ) && ! empty( $incident->snapshot_ciphertext ),
			'events'         => $events,
			'map_url'        => $this->osm_url( $snapshot ),
			'route_points'   => $this->route_points( $snapshot ),
		);
	}

	/** @return array<string,string>|WP_Error */
	public function operator_action( string $public_id, string $action, int $wp_user_id, string $display_name ): array|WP_Error {
		if ( $wp_user_id < 1 || get_current_user_id() !== $wp_user_id || ! user_can( $wp_user_id, 'avenra_halo_emergency_operate' ) ) {
			return new WP_Error( 'operations_forbidden', __( 'You are not authorised to update Emergency Assist incidents.', 'avenra-halo-v2' ) );
		}
		$incident = $this->incident_by_public_id( sanitize_text_field( $public_id ) );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
		}
		$action = sanitize_key( $action );
		if ( ! in_array( $action, array( 'acknowledge', 'rider_no_answer', 'rider_confirmed', 'false_alarm', 'emergency_services_called', 'alert_next_of_kin', 'handover_complete', 'test_complete' ), true ) ) {
			return new WP_Error( 'emergency_action_invalid', __( 'That Emergency Assist action is unavailable.', 'avenra-halo-v2' ) );
		}
		$role = 'wp_' . $wp_user_id;
		if ( 'acknowledge' === $action ) {
			return $this->acknowledge_as( $incident, $role, $display_name, array( 'attribution' => 'authenticated_wp_operator', 'wp_user_id' => $wp_user_id ) );
		}
		return $this->perform_responder_action( $incident, $role, $action );
	}

	/**
	 * Return the rider's newest unresolved activated incident for bootstrap
	 * recovery. The response intentionally contains status identifiers only;
	 * protected rider, vehicle and telemetry data remains dashboard-only.
	 *
	 * @return array<string,mixed>|null
	 */
	public function get_latest_unresolved_status( int $customer_id ): ?array {
		global $wpdb;

		if ( $customer_id < 1 || ! $this->db->table_exists( $this->db->table( 'incidents' ) ) ) {
			return null;
		}
		$incident = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT * FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE customer_id = %d AND is_test = 0 AND status IN ('active','acknowledged') ORDER BY activated_at DESC, id DESC LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id
			)
		);
		return is_object( $incident ) ? $this->incident_response( $incident ) : null;
	}

	/** Whether encryption, destinations and an SMS adapter are ready. */
	public function provider_ready(): bool {
		$status = $this->provider_status();
		return ! empty( $status['ready'] );
	}

	/** @return array<string,mixed> Safe for an administrator/status endpoint. */
	public function provider_status(): array {
		$encryption = $this->encryption_status();
		$primary    = $this->destination( 'primary' );
		$backup     = $this->destination( 'backup' );
		$override   = has_filter( 'avenra_halo_v2_emergency_sms_delivery' );
		$firetext   = defined( 'AVENRA_FIRETEXT_API_KEY' ) && '' !== trim( (string) AVENRA_FIRETEXT_API_KEY );
		$storage    = $this->storage_ready();
		$secure_dashboard = 'https' === strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_SCHEME ) );

		return array(
			'ready'                => $storage && $secure_dashboard && ! empty( $encryption['ready'] ) && '' !== $primary && '' !== $backup && ( $override || $firetext ),
			'storage_ready'        => $storage,
			'secure_dashboard'     => $secure_dashboard,
			'encryption'           => $encryption,
			'sms_adapter'          => $override ? 'filtered' : 'firetext',
			'firetext_configured'  => $firetext,
			'primary_configured'   => '' !== $primary,
			'primary_last_four'    => '' !== $primary ? substr( $primary, -4 ) : '',
			'backup_configured'    => '' !== $backup,
			'backup_last_four'     => '' !== $backup ? substr( $backup, -4 ) : '',
			'action_scheduler'     => function_exists( 'as_schedule_single_action' ),
			'wp_cron_fallback'     => true,
			'dashboard_path'       => '/halo-assist/',
			'consent_version'      => $this->required_consent_version(),
		);
	}

	/** @return array<string,mixed> */
	public function encryption_status(): array {
		$key = $this->encryption_key();
		$algorithm = function_exists( 'sodium_crypto_aead_xchacha20poly1305_ietf_encrypt' )
			? 'xchacha20-poly1305'
			: ( function_exists( 'openssl_encrypt' ) && function_exists( 'openssl_get_cipher_methods' ) && in_array( 'aes-256-gcm', openssl_get_cipher_methods(), true ) ? 'aes-256-gcm' : 'unavailable' );
		return array(
			'ready'     => ! is_wp_error( $key ) && 'unavailable' !== $algorithm,
			'algorithm' => $algorithm,
			'key_source'=> 'derived-filterable',
		);
	}

	/** @return array{token:string}|WP_Error */
	private function prepare_primary_attempt( object $incident, array $input = array() ): array|WP_Error {
		global $wpdb;

		$consent_locks = $this->acquire_snapshot_consent_locks( (int) $incident->customer_id );
		if ( is_wp_error( $consent_locks ) ) {
			return $consent_locks;
		}
		try {
			$lock = $this->db->acquire_advisory_lock( 'emergency-incident-id', (string) $incident->id, 2 );
			if ( ! $lock ) {
				return new WP_Error( 'emergency_incident_busy', __( 'Emergency Assist is already processing this incident.', 'avenra-halo-v2' ) );
			}
			try {
				$current = $this->incident_by_id( (int) $incident->id );
				if ( ! $current || 'candidate' !== (string) $current->status ) {
					return array( 'token' => '' );
				}
				if ( ! $this->has_assist_consent( (int) $current->customer_id ) ) {
					$cancelled = $this->cancel_candidate_under_incident_lock( $current, 'consent_revoked' );
					if ( is_wp_error( $cancelled ) ) {
						return $cancelled;
					}
					return new WP_Error( 'emergency_consent_required', __( 'Emergency Assist consent is no longer current, so this pending incident was cancelled without contacting a responder.', 'avenra-halo-v2' ) );
				}

				// Always rebuild, including scheduled activations with no new payload.
				// This makes current medical and next-of-kin consent authoritative at
				// the same locked transition that makes responder contact possible.
				$ciphertext = $this->merged_snapshot_ciphertext( $current, $input );
				if ( is_wp_error( $ciphertext ) ) {
					return $ciphertext;
				}
				$token = $this->random_token();
				if ( '' === $token ) {
					return new WP_Error( 'emergency_token_unavailable', __( 'Emergency Assist could not create a secure response link.', 'avenra-halo-v2' ) );
				}
				$now        = current_time( 'mysql', true );
				$expires_at = gmdate( 'Y-m-d H:i:s', time() + $this->token_lifetime() );
				$due_at     = gmdate( 'Y-m-d H:i:s', time() + $this->backup_delay() );
				$data       = array(
					'status'                => 'active',
					'activation_due_at'     => null,
					'activated_at'          => $now,
					'primary_token_hash'    => $this->token_hash( $token ),
					'primary_session_hash'  => null,
					'primary_expires_at'    => $expires_at,
					'primary_status'        => 'attempting',
					'escalation_due_at'     => $due_at,
					'snapshot_ciphertext'   => $ciphertext,
					'updated_at'            => $now,
				);
				if ( $input ) {
				$occurrence = $this->input_occurrence( $input );
				if ( null !== $occurrence ) {
					$data['occurred_at'] = $this->mysql_time( $occurrence );
				}
				}
				$updated = $wpdb->update(
					$this->db->table( 'incidents' ),
					$data,
					array( 'id' => (int) $incident->id, 'status' => 'candidate' )
				);
				if ( false === $updated ) {
					return new WP_Error( 'emergency_activation_failed', __( 'The Emergency Assist incident could not be activated.', 'avenra-halo-v2' ) );
				}
				return 1 === $updated ? array( 'token' => $token ) : array( 'token' => '' );
			} finally {
				$this->db->release_advisory_lock( $lock );
			}
		} finally {
			$this->release_snapshot_consent_locks( $consent_locks );
		}
	}

	/** @return array{state:string,definitive:bool,provider:string,provider_message_id:string,safe_code:string} */
	private function deliver_responder_sms( object $incident, string $role, string $token ): array {
		$is_test = $this->is_test_incident( $incident );
		if ( 'simulation' === (string) ( $incident->source ?? '' ) ) {
			$scenario = sanitize_key( (string) ( $incident->test_scenario ?? 'happy_path' ) );
			if ( 'primary' === $role && 'primary_rejected' === $scenario ) {
				return $this->delivery_result( 'failed', true, 'simulation', '', 'simulated_rejection' );
			}
			if ( 'primary' === $role && 'primary_timeout' === $scenario ) {
				return $this->delivery_result( 'unknown', false, 'simulation', '', 'simulated_timeout' );
			}
			return $this->delivery_result( 'accepted', true, 'simulation', 'sim-' . substr( (string) $incident->public_id, 0, 8 ) . '-' . $role, 'simulated_acceptance' );
		}

		$destination = $this->destination( $role );
		if ( '' === $destination || '' === $token ) {
			return $this->delivery_result( 'failed', true, 'unavailable', '', 'destination_unavailable' );
		}

		// The explicit exchange marker guarantees that an older legacy responder
		// cookie cannot intercept a newly opened SMS fragment before JavaScript has
		// exchanged it for the correct incident-and-role scoped session.
		$link    = add_query_arg( 'exchange', '1', trailingslashit( home_url( '/halo-assist/' ) ) ) . '#' . rawurlencode( $token );
		$prefix  = $is_test ? 'TEST EXERCISE - NO ACCIDENT - DO NOT CALL 999. ' : '';
		$message = $prefix . ( 'backup' === $role ? 'Avenra Halo backup response requested. ' : 'Avenra Halo Emergency Assist. ' ) . 'Open the private incident dashboard now: ' . $link;
		$message = $this->text( wp_strip_all_tags( $message ), 480 );
		$context = array(
			'role'               => $role,
			'destination'        => $destination,
			'message'            => $message,
			'incident_public_id' => sanitize_text_field( (string) $incident->public_id ),
			'is_test'            => $is_test,
			'test_dispatch_mode' => $is_test ? sanitize_key( (string) ( $incident->test_dispatch_mode ?? '' ) ) : '',
		);

		try {
			$override = apply_filters( 'avenra_halo_v2_emergency_sms_delivery', null, $context );
		} catch ( Throwable $error ) {
			return $this->delivery_result( 'failed', true, 'filtered', '', 'adapter_exception' );
		}
		if ( null !== $override ) {
			return $this->normalise_delivery_override( $override );
		}

		$api_key = defined( 'AVENRA_FIRETEXT_API_KEY' ) ? trim( (string) AVENRA_FIRETEXT_API_KEY ) : '';
		if ( '' === $api_key ) {
			return $this->delivery_result( 'failed', true, 'firetext', '', 'provider_not_configured' );
		}
		try {
			$sender_value = (string) apply_filters( 'avenra_halo_v2_emergency_sms_sender', 'Avenra' );
		} catch ( Throwable $error ) {
			$sender_value = 'Avenra';
		}
		$sender = preg_replace( '/[^A-Za-z0-9]/', '', $sender_value );
		$sender = substr( (string) $sender, 0, 11 );
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
						'message' => $message,
						'from'    => $sender,
						'to'      => $destination,
					),
				)
			);
		} catch ( Throwable $error ) {
			return $this->delivery_result( 'failed', true, 'firetext', '', 'transport_exception' );
		}
		if ( is_wp_error( $response ) ) {
			$code = strtolower( $response->get_error_code() );
			$unknown = str_contains( $code, 'timeout' ) || str_contains( strtolower( $response->get_error_message() ), 'timed out' );
			return $this->delivery_result( $unknown ? 'unknown' : 'failed', ! $unknown, 'firetext', '', $unknown ? 'transport_timeout' : 'transport_failed' );
		}

		$http = (int) wp_remote_retrieve_response_code( $response );
		$body = trim( (string) wp_remote_retrieve_body( $response ) );
		if ( 200 === $http && preg_match( '/^0\s*:/', $body ) ) {
			$message_id = $this->provider_id( wp_remote_retrieve_header( $response, 'x-message' ) );
			return $this->delivery_result( 'accepted', true, 'firetext', $message_id, 'accepted' );
		}
		if ( $http >= 500 || 429 === $http || ( $http >= 200 && $http < 300 && '' === $body ) ) {
			return $this->delivery_result( 'unknown', false, 'firetext', '', 'provider_unconfirmed' );
		}
		$provider_code = preg_match( '/^(\d{1,3})\s*:/', $body, $matches ) ? 'firetext_' . $matches[1] : 'provider_rejected';
		return $this->delivery_result( 'failed', true, 'firetext', '', $provider_code );
	}

	/** @return array{state:string,definitive:bool,provider:string,provider_message_id:string,safe_code:string} */
	private function normalise_delivery_override( mixed $result ): array {
		if ( is_wp_error( $result ) ) {
			$error_data = $result->get_error_data();
			$retryable = is_array( $error_data ) && ! empty( $error_data['retryable'] );
			return $this->delivery_result( $retryable ? 'unknown' : 'failed', ! $retryable, 'filtered', '', sanitize_key( $result->get_error_code() ) ?: 'adapter_failed' );
		}
		if ( ! is_array( $result ) ) {
			return $this->delivery_result( 'failed', true, 'filtered', '', 'adapter_invalid_result' );
		}
		$accepted = true === ( $result['accepted'] ?? null );
		if ( $accepted ) {
			return $this->delivery_result( 'accepted', true, sanitize_key( (string) ( $result['provider'] ?? 'filtered' ) ), $this->provider_id( $result['provider_message_id'] ?? $result['message_id'] ?? '' ), 'accepted' );
		}
		$state      = in_array( (string) ( $result['state'] ?? '' ), array( 'unknown', 'retrying' ), true ) || ! empty( $result['retryable'] ) ? 'unknown' : 'failed';
		$definitive = 'failed' === $state && true !== ( $result['definitive'] ?? true ) ? false : 'failed' === $state;
		return $this->delivery_result( $state, $definitive, sanitize_key( (string) ( $result['provider'] ?? 'filtered' ) ), '', sanitize_key( (string) ( $result['code'] ?? 'adapter_rejected' ) ) );
	}

	/** @return array{state:string,definitive:bool,provider:string,provider_message_id:string,safe_code:string} */
	private function delivery_result( string $state, bool $definitive, string $provider, string $provider_id, string $safe_code ): array {
		return array(
			'state'               => in_array( $state, array( 'accepted', 'failed', 'unknown' ), true ) ? $state : 'failed',
			'definitive'          => $definitive,
			'provider'            => sanitize_key( $provider ) ?: 'unknown',
			'provider_message_id' => $this->provider_id( $provider_id ),
			'safe_code'           => sanitize_key( $safe_code ) ?: 'provider_failed',
		);
	}

	/**
	 * @param array{state:string,definitive:bool,provider:string,provider_message_id:string,safe_code:string} $result
	 * @return bool|WP_Error
	 */
	private function record_provider_result( int $incident_id, string $role, array $result ): bool|WP_Error {
		global $wpdb;

		if ( ! in_array( $role, array( 'primary', 'backup' ), true ) ) {
			return new WP_Error( 'emergency_provider_role_invalid', __( 'The responder delivery role was invalid.', 'avenra-halo-v2' ) );
		}
		// There is intentionally no hidden retry for an indeterminate provider
		// response. Store it as terminal "unconfirmed", contact the backup
		// inline, and tell the rider to call 999 if neither destination is
		// explicitly accepted. This avoids an incident remaining "processing"
		// forever after a timeout or ambiguous 2xx/5xx response.
		$stored_state = 'unknown' === $result['state'] ? 'unconfirmed' : $result['state'];
		$now  = current_time( 'mysql', true );
		$data = array(
			$role . '_status'      => $stored_state,
			$role . '_provider_id' => '' !== $result['provider_message_id'] ? $result['provider_message_id'] : null,
			'updated_at'           => $now,
		);
		if ( 'accepted' === $result['state'] ) {
			$data[ $role . '_sent_at' ] = $now;
		}
		$updated = $wpdb->update( $this->db->table( 'incidents' ), $data, array( 'id' => $incident_id ) );
		if ( false === $updated ) {
			return new WP_Error( 'emergency_provider_result_persistence_failed', __( 'Halo could not durably record the responder provider outcome.', 'avenra-halo-v2' ) );
		}
		if ( 0 === $updated ) {
			$current = $this->incident_by_id( $incident_id );
			$status_property = $role . '_status';
			$id_property     = $role . '_provider_id';
			$current_id      = is_object( $current ) ? (string) ( $current->{$id_property} ?? '' ) : '';
			$expected_id     = (string) ( $data[ $role . '_provider_id' ] ?? '' );
			if ( ! $current || (string) ( $current->{$status_property} ?? '' ) !== $stored_state || $current_id !== $expected_id ) {
				return new WP_Error( 'emergency_provider_result_persistence_failed', __( 'Halo could not durably record the responder provider outcome.', 'avenra-halo-v2' ) );
			}
		}
		$this->append_event(
			$incident_id,
			'accepted' === $result['state'] ? 'provider_acceptance' : 'provider_failure',
			$role,
			array(
				'provider'   => $result['provider'],
				'state'      => $stored_state,
				'provider_response_state' => $result['state'],
				'safe_code'  => $result['safe_code'],
				'definitive' => $result['definitive'],
			)
		);
		return true;
	}

	/** Idempotently contact the backup destination. */
	public function escalate_backup( int $incident_id ): array|WP_Error {
		global $wpdb;

		$lock = $this->db->acquire_advisory_lock( 'emergency-escalation', (string) $incident_id, 2 );
		if ( ! $lock ) {
			return new WP_Error( 'emergency_escalation_busy', __( 'Emergency Assist escalation is already being processed.', 'avenra-halo-v2' ) );
		}
		$token = '';
		try {
			$incident = $this->incident_by_id( $incident_id );
			if ( ! $incident ) {
				return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
			}
			if ( null !== $incident->first_acknowledged_at || in_array( (string) $incident->status, array( 'cancelled', 'false_alarm', 'resolved' ), true ) || 'pending' !== (string) $incident->backup_status ) {
				$response               = $this->incident_response( $incident );
				$response['idempotent'] = true;
				return $response;
			}

			$token      = $this->random_token();
			if ( '' === $token ) {
				return new WP_Error( 'emergency_token_unavailable', __( 'Emergency Assist could not create a secure backup link.', 'avenra-halo-v2' ) );
			}
			$now        = current_time( 'mysql', true );
			$expires_at = gmdate( 'Y-m-d H:i:s', time() + $this->token_lifetime() );
			$updated    = $wpdb->query(
				$wpdb->prepare(
					"UPDATE `" . esc_sql( $this->db->table( 'incidents' ) ) . "` SET backup_token_hash = %s, backup_session_hash = NULL, backup_expires_at = %s, backup_status = 'attempting', escalation_due_at = NULL, updated_at = %s WHERE id = %d AND backup_status = 'pending' AND first_acknowledged_at IS NULL AND status NOT IN ('cancelled','false_alarm','resolved')", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$this->token_hash( $token ),
					$expires_at,
					$now,
					$incident_id
				)
			);
			if ( 1 !== $updated ) {
				$current                = $this->incident_by_id( $incident_id );
				$response               = $current ? $this->incident_response( $current ) : array( 'incident_id' => $incident_id );
				$response['idempotent'] = true;
				return $response;
			}
		} finally {
			$this->db->release_advisory_lock( $lock );
		}

		$incident = $this->incident_by_id( $incident_id );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be refreshed.', 'avenra-halo-v2' ) );
		}
		$this->append_event( $incident_id, 'backup_escalation', 'system', array( 'primary_state' => sanitize_key( (string) $incident->primary_status ) ) );
		$this->append_event( $incident_id, 'provider_attempt', 'backup', array( 'provider' => $this->dispatch_provider_label( $incident ) ) );
		$result    = $this->deliver_responder_sms( $incident, 'backup', $token );
		$persisted = $this->record_provider_result( $incident_id, 'backup', $result );
		if ( is_wp_error( $persisted ) ) {
			return $persisted;
		}
		if ( 'accepted' === $result['state'] ) {
			$this->schedule_background( 'avenra_halo_v2_emergency_enrich', $incident_id, time() + 1 );
		}
		$current = $this->incident_by_id( $incident_id );
		return $current ? $this->incident_response( $current ) : new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be refreshed.', 'avenra-halo-v2' ) );
	}

	public function process_scheduled_escalation( mixed $incident_id ): void {
		$this->escalate_backup( absint( $incident_id ) );
	}

	/** Activate a committed candidate if the rider's cancellation window elapsed. */
	public function process_scheduled_candidate_activation( mixed $incident_id, mixed $retry_attempt = 0 ): void {
		$retry_attempt = min( self::CANDIDATE_RETRY_LIMIT, max( 0, absint( $retry_attempt ) ) );
		$incident = $this->incident_by_id( absint( $incident_id ) );
		if ( ! $incident || 'candidate' !== (string) $incident->status ) {
			return;
		}
		$due = '' !== (string) ( $incident->activation_due_at ?? '' ) ? strtotime( (string) $incident->activation_due_at . ' UTC' ) : false;
		if ( false === $due || $due > time() ) {
			if ( false !== $due ) {
				// A distinct attempt argument avoids Action Scheduler treating the
				// currently running action as the future replacement action.
				$this->schedule_candidate_retry( (int) $incident->id, min( self::CANDIDATE_RETRY_LIMIT, $retry_attempt + 1 ), $due );
			}
			return;
		}
		if ( ! $this->has_assist_consent( (int) $incident->customer_id ) ) {
			$this->cancel_incident( (int) $incident->customer_id, (string) $incident->client_event_id, 'consent_revoked' );
			return;
		}
		$result = $this->activate_incident(
			(int) $incident->customer_id,
			(string) $incident->client_event_id,
			array(),
			(string) $incident->source
		);
		if ( is_wp_error( $result ) ) {
			$this->append_event(
				(int) $incident->id,
				'activation_failure',
				'system',
				array( 'safe_code' => sanitize_key( $result->get_error_code() ), 'retry_attempt' => $retry_attempt )
			);
			$current = $this->incident_by_id( (int) $incident->id );
			if ( ! $current || 'candidate' !== (string) $current->status ) {
				$this->clear_candidate_activation( (int) $incident->id );
				return;
			}
			if ( ! $this->has_assist_consent( (int) $current->customer_id ) ) {
				$this->cancel_incident( (int) $current->customer_id, (string) $current->client_event_id, 'consent_revoked' );
				return;
			}
			if ( $retry_attempt < self::CANDIDATE_RETRY_LIMIT ) {
				$next_attempt = $retry_attempt + 1;
				$delay        = array( 1 => 5, 2 => 15, 3 => 45 )[ $next_attempt ];
				$this->schedule_candidate_retry( (int) $current->id, $next_attempt, time() + $delay );
				$this->append_event(
					(int) $current->id,
					'activation_retry_scheduled',
					'system',
					array( 'retry_attempt' => $next_attempt, 'delay_seconds' => $delay )
				);
			}
		}
	}

	public function request_time_due_checks(): void {
		global $wpdb;

		if ( ! $this->storage_ready() ) {
			return;
		}
		$candidate_ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT id FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE status = 'candidate' AND activation_due_at IS NOT NULL AND activation_due_at <= %s ORDER BY activation_due_at ASC LIMIT 5", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				current_time( 'mysql', true )
			)
		);
		foreach ( $candidate_ids as $incident_id ) {
			$this->process_scheduled_candidate_activation( (int) $incident_id );
		}
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT id FROM `" . esc_sql( $this->db->table( 'incidents' ) ) . "` WHERE status NOT IN ('cancelled','false_alarm','resolved') AND first_acknowledged_at IS NULL AND backup_status = 'pending' AND escalation_due_at IS NOT NULL AND escalation_due_at <= %s ORDER BY escalation_due_at ASC LIMIT 5", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				current_time( 'mysql', true )
			)
		);
		foreach ( $ids as $incident_id ) {
			$this->escalate_backup( (int) $incident_id );
		}
	}

	private function schedule_escalation( int $incident_id, int $timestamp ): void {
		$this->schedule_background( 'avenra_halo_v2_emergency_escalate', $incident_id, max( time() + 1, $timestamp ) );
	}

	private function schedule_background( string $hook, int $incident_id, int $timestamp ): void {
		$this->schedule_background_args( $hook, array( $incident_id ), $timestamp );
	}

	/** A retry's second argument is deliberately part of its scheduler identity. */
	private function schedule_candidate_retry( int $incident_id, int $attempt, int $timestamp ): void {
		$attempt = min( self::CANDIDATE_RETRY_LIMIT, max( 1, $attempt ) );
		$this->schedule_background_args(
			'avenra_halo_v2_emergency_activate_candidate',
			array( $incident_id, $attempt ),
			max( time() + 1, $timestamp )
		);
	}

	/** @param array<int,int> $args */
	private function schedule_background_args( string $hook, array $args, int $timestamp ): void {
		$scheduled = false;
		if ( function_exists( 'as_schedule_single_action' ) ) {
			try {
				if ( function_exists( 'as_has_scheduled_action' ) && as_has_scheduled_action( $hook, $args, 'avenra-halo-v2' ) ) {
					$scheduled = true;
				} else {
					$scheduled = (bool) as_schedule_single_action( $timestamp, $hook, $args, 'avenra-halo-v2' );
				}
			} catch ( Throwable $error ) {
				$scheduled = false;
			}
		}
		if ( ! $scheduled && ! wp_next_scheduled( $hook, $args ) ) {
			wp_schedule_single_event( $timestamp, $hook, $args );
		}
	}

	private function clear_background( string $hook, int $incident_id ): void {
		$this->clear_background_args( $hook, array( $incident_id ) );
	}

	private function clear_candidate_activation( int $incident_id ): void {
		$this->clear_background( 'avenra_halo_v2_emergency_activate_candidate', $incident_id );
		for ( $attempt = 1; $attempt <= self::CANDIDATE_RETRY_LIMIT; $attempt++ ) {
			$this->clear_background_args( 'avenra_halo_v2_emergency_activate_candidate', array( $incident_id, $attempt ) );
		}
	}

	/** @param array<int,int> $args */
	private function clear_background_args( string $hook, array $args ): void {
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			try {
				as_unschedule_all_actions( $hook, $args, 'avenra-halo-v2' );
			} catch ( Throwable $error ) {
				// WP-Cron is cleared below; a running Action Scheduler job is idempotent.
			}
		}
		wp_clear_scheduled_hook( $hook, $args );
	}

	/** Append safe, non-rich audit metadata. */
	public function append_event( int $incident_id, string $event_type, string $actor_role = 'system', array $metadata = array() ): bool {
		global $wpdb;

		$event_type = sanitize_key( $event_type );
		$actor_role = sanitize_key( $actor_role );
		if ( $incident_id < 1 || '' === $event_type || ! $this->db->table_exists( $this->db->table( 'incident_events' ) ) ) {
			return false;
		}
		$encoded = empty( $metadata ) ? null : wp_json_encode( $this->safe_event_metadata( $metadata ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		return false !== $wpdb->insert(
			$this->db->table( 'incident_events' ),
			array(
				'incident_id'  => $incident_id,
				'event_type'   => $this->text( $event_type, 48 ),
				'actor_role'   => $this->text( $actor_role ?: 'system', 24 ),
				'metadata_json'=> $encoded,
				'created_at'   => current_time( 'mysql', true ),
			)
		);
	}

	/** Serve the clean first-party exchange shell or an authenticated dashboard. */
	public function serve_responder(): void {
		if ( 1 !== (int) get_query_var( self::QUERY_VAR ) ) {
			return;
		}
		if ( ! $this->storage_ready() ) {
			$this->render_unavailable( 503 );
		}
		$request_method = strtoupper( (string) ( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) );
		$exchange_value = isset( $_GET['exchange'] ) && is_scalar( $_GET['exchange'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['exchange'] ) ) : '';
		$exchange_only  = '1' === $exchange_value;
		if ( 'GET' === $request_method && $exchange_only ) {
			$this->render_exchange_shell();
		}

		if ( 'POST' === $request_method ) {
			$action = isset( $_POST['emergency_action'] ) ? sanitize_key( wp_unslash( $_POST['emergency_action'] ) ) : '';
			if ( 'exchange' === $action ) {
				$this->handle_token_exchange();
			}
			$session = $this->responder_session();
			if ( ! $session ) {
				$this->clear_requested_responder_cookie();
				$this->render_unavailable( 404 );
			}
			$this->handle_dashboard_action( $session, $action );
		}

		$session = $this->responder_session();
		if ( ! $session ) {
			$this->render_exchange_shell();
		}
		$this->render_dashboard( $session );
	}

	private function handle_token_exchange(): void {
		if ( 'https' !== strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_SCHEME ) ) ) {
			$this->json_response( false, 'secure_transport_required', 503 );
		}
		if ( ! $this->same_origin_request() ) {
			$this->json_response( false, 'invalid_origin', 403 );
		}
		$nonce = isset( $_POST['exchange_nonce'] ) ? sanitize_text_field( wp_unslash( $_POST['exchange_nonce'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'avenra_halo_v2_emergency_exchange' ) ) {
			$this->json_response( false, 'exchange_expired', 403 );
		}
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
		if ( ! $this->db->consume_rate_limit( 'emergency-exchange', $ip, 30, 15 * MINUTE_IN_SECONDS ) ) {
			$this->json_response( false, 'exchange_throttled', 429 );
		}

		$token = isset( $_POST['token'] ) ? trim( (string) wp_unslash( $_POST['token'] ) ) : '';
		if ( ! preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $token ) ) {
			$this->json_response( false, 'link_unavailable', 404 );
		}
		$matched = $this->incident_for_bearer_hash( $this->token_hash( $token ) );
		if ( ! $matched ) {
			$this->json_response( false, 'link_unavailable', 404 );
		}

		global $wpdb;
		$role         = 'backup' === (string) $matched['role'] ? 'backup' : 'primary';
		$token_column = $role . '_token_hash';
		$session_column = $role . '_session_hash';
		$expiry_column  = $role . '_expires_at';
		$token_hash     = $this->token_hash( $token );
		$dashboard_url  = $this->responder_dashboard_url( $matched['incident'], $role );
		$current_session_hash = (string) ( $matched['incident']->{$session_column} ?? '' );
		if ( '' !== $current_session_hash ) {
			// The bearer remains reusable only on the device that already owns this
			// incident-and-role session. It cannot establish or replace a session on
			// another device after the session-null compare-and-swap has succeeded.
			$existing_session_token = $this->responder_cookie_token( $matched['incident'], $role, true );
			if ( '' !== $existing_session_token && hash_equals( $current_session_hash, $this->token_hash( $existing_session_token ) ) ) {
				$this->json_response( true, 'exchanged', 200, array( 'dashboard_url' => $dashboard_url ) );
			}
			$this->json_response( false, 'link_unavailable', 404 );
		}

		$session_token = $this->random_token();
		if ( '' === $session_token ) {
			$this->json_response( false, 'link_unavailable', 503 );
		}
		$session_hash   = $this->token_hash( $session_token );
		$updated        = $wpdb->query(
			$wpdb->prepare(
				'UPDATE `' . esc_sql( $this->db->table( 'incidents' ) ) . '` SET `' . esc_sql( $session_column ) . '` = %s, updated_at = %s WHERE id = %d AND `' . esc_sql( $token_column ) . '` = %s AND `' . esc_sql( $session_column ) . '` IS NULL AND `' . esc_sql( $expiry_column ) . '` > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$session_hash,
				current_time( 'mysql', true ),
				(int) $matched['incident']->id,
				$token_hash,
				current_time( 'mysql', true )
			)
		);
		if ( 1 !== $updated ) {
			$this->json_response( false, 'link_unavailable', false === $updated ? 503 : 404 );
		}
		if ( ! $this->set_responder_cookie( $session_token, (string) $matched['expires_at'], $matched['incident'], $role ) ) {
			// Release only this exact failed session reservation. The bearer was
			// deliberately retained, so the same link remains retryable without
			// allowing a concurrent exchange to evict another device.
			$wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'incidents' ) ) . '` SET `' . esc_sql( $session_column ) . '` = NULL, updated_at = %s WHERE id = %d AND `' . esc_sql( $session_column ) . '` = %s AND `' . esc_sql( $token_column ) . '` = %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					(int) $matched['incident']->id,
					$session_hash,
					$token_hash
				)
			);
			$this->json_response( false, 'link_unavailable', 503 );
		}
		$this->json_response( true, 'exchanged', 200, array( 'dashboard_url' => $dashboard_url ) );
	}

	/** @return array{incident:object,role:string,session_token:string,expires_at:string}|null */
	private function responder_session(): ?array {
		global $wpdb;
		$target_supplied = isset( $_GET['incident'] ) || isset( $_GET['role'] );
		if ( $target_supplied ) {
			$public_id = isset( $_GET['incident'] ) && is_scalar( $_GET['incident'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['incident'] ) ) : '';
			$role      = isset( $_GET['role'] ) && is_scalar( $_GET['role'] ) ? sanitize_key( (string) wp_unslash( $_GET['role'] ) ) : '';
			if ( ! preg_match( '/^[a-fA-F0-9-]{36}$/', $public_id ) || ! in_array( $role, array( 'primary', 'backup' ), true ) ) {
				return null;
			}
			$row = $this->incident_by_public_id( $public_id );
			if ( ! $row ) {
				return null;
			}
			$token = $this->responder_cookie_token( $row, $role, true );
			if ( '' === $token ) {
				return null;
			}
			$hash           = $this->token_hash( $token );
			$session_column = $role . '_session_hash';
			$expiry_column  = $role . '_expires_at';
			$expires_at     = (string) ( $row->{$expiry_column} ?? '' );
			$expiry         = '' !== $expires_at ? strtotime( $expires_at . ' UTC' ) : false;
			if ( empty( $row->{$session_column} ) || ! hash_equals( (string) $row->{$session_column}, $hash ) || false === $expiry || $expiry < time() ) {
				return null;
			}
			return array( 'incident' => $row, 'role' => $role, 'session_token' => $token, 'expires_at' => $expires_at );
		}

		// Compatibility for responder sessions issued before incident-scoped
		// cookies were introduced. A legacy cookie may select one incident only;
		// every newly exchanged link receives its own scoped cookie and URL.
		$token = isset( $_COOKIE[ self::COOKIE ] ) ? trim( sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) ) : '';
		if ( ! preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $token ) ) {
			return null;
		}
		$hash = $this->token_hash( $token );
		$row  = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE primary_session_hash = %s OR backup_session_hash = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$hash,
				$hash
			)
		);
		if ( ! is_object( $row ) ) {
			return null;
		}
		$role       = hash_equals( (string) ( $row->primary_session_hash ?? '' ), $hash ) ? 'primary' : ( hash_equals( (string) ( $row->backup_session_hash ?? '' ), $hash ) ? 'backup' : '' );
		$expires_at = 'primary' === $role ? (string) $row->primary_expires_at : ( 'backup' === $role ? (string) $row->backup_expires_at : '' );
		$expiry     = '' !== $expires_at ? strtotime( $expires_at . ' UTC' ) : false;
		if ( '' === $role || false === $expiry || $expiry < time() ) {
			return null;
		}
		return array( 'incident' => $row, 'role' => $role, 'session_token' => $token, 'expires_at' => $expires_at );
	}

	/** @return array{incident:object,role:string,expires_at:string}|null */
	private function incident_for_bearer_hash( string $hash ): ?array {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE primary_token_hash = %s OR backup_token_hash = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$hash,
				$hash
			)
		);
		if ( ! is_object( $row ) ) {
			return null;
		}
		$role       = hash_equals( (string) ( $row->primary_token_hash ?? '' ), $hash ) ? 'primary' : ( hash_equals( (string) ( $row->backup_token_hash ?? '' ), $hash ) ? 'backup' : '' );
		$expires_at = 'primary' === $role ? (string) $row->primary_expires_at : ( 'backup' === $role ? (string) $row->backup_expires_at : '' );
		$expiry     = '' !== $expires_at ? strtotime( $expires_at . ' UTC' ) : false;
		if ( '' === $role || false === $expiry || $expiry < time() ) {
			return null;
		}
		return array( 'incident' => $row, 'role' => $role, 'expires_at' => $expires_at );
	}

	/** @param array{incident:object,role:string,session_token:string,expires_at:string} $session */
	private function handle_dashboard_action( array $session, string $action ): void {
		$allowed = array( 'acknowledge', 'rider_no_answer', 'rider_confirmed', 'false_alarm', 'emergency_services_called', 'alert_next_of_kin', 'handover_complete', 'test_complete' );
		if ( ! in_array( $action, $allowed, true ) || ! $this->same_origin_request() ) {
			$this->store_notice( $session['session_token'], __( 'That Emergency Assist action was not accepted.', 'avenra-halo-v2' ), 'error' );
			$this->redirect_dashboard( $session );
		}
		$csrf = isset( $_POST['emergency_csrf'] ) ? sanitize_text_field( wp_unslash( $_POST['emergency_csrf'] ) ) : '';
		if ( ! hash_equals( $this->responder_csrf( $session['session_token'] ), $csrf ) ) {
			$this->store_notice( $session['session_token'], __( 'The secure action token expired. Reload the dashboard.', 'avenra-halo-v2' ), 'error' );
			$this->redirect_dashboard( $session );
		}
		if ( ! $this->db->consume_rate_limit( 'emergency-dashboard', $this->token_hash( $session['session_token'] ), 60, 10 * MINUTE_IN_SECONDS ) ) {
			$this->store_notice( $session['session_token'], __( 'Please wait before submitting another update.', 'avenra-halo-v2' ), 'error' );
			$this->redirect_dashboard( $session );
		}

		$incident = $this->incident_by_id( (int) $session['incident']->id );
		if ( ! $incident ) {
			$this->render_unavailable( 404 );
		}
		$result = 'acknowledge' === $action
			? $this->acknowledge_incident( $incident, $session['role'] )
			: $this->perform_responder_action( $incident, $session['role'], $action );
		if ( is_wp_error( $result ) ) {
			$this->store_notice( $session['session_token'], $result->get_error_message(), 'error' );
		} else {
			$this->store_notice( $session['session_token'], (string) ( $result['message'] ?? __( 'Emergency Assist was updated.', 'avenra-halo-v2' ) ), 'success' );
		}
		$this->redirect_dashboard( $session );
	}

	/** @return array<string,string>|WP_Error */
	private function acknowledge_incident( object $incident, string $role ): array|WP_Error {
		$name = isset( $_POST['responder_name'] ) ? $this->text( sanitize_text_field( wp_unslash( $_POST['responder_name'] ) ), 80 ) : '';
		return $this->acknowledge_as( $incident, $role, $name, array( 'attribution' => 'device_role' ) );
	}

	/** @param array<string,mixed> $metadata @return array<string,string>|WP_Error */
	private function acknowledge_as( object $incident, string $role, string $name, array $metadata = array() ): array|WP_Error {
		global $wpdb;

		if ( ! in_array( (string) ( $incident->status ?? '' ), array( 'active', 'acknowledged' ), true ) || empty( $incident->activated_at ) ) {
			return new WP_Error( 'emergency_incident_not_activated', __( 'This incident is still inside the rider cancellation window and cannot be acknowledged.', 'avenra-halo-v2' ) );
		}
		$role = $this->text( sanitize_key( $role ), 32 );
		$name = $this->text( sanitize_text_field( $name ), 80 );
		if ( '' === $role ) {
			return new WP_Error( 'responder_role_required', __( 'A response role is required.', 'avenra-halo-v2' ) );
		}
		if ( strlen( $name ) < 2 ) {
			return new WP_Error( 'responder_name_required', __( 'Enter your name or initials before acknowledging.', 'avenra-halo-v2' ) );
		}
		$ciphertext = $this->encrypt_value( array( 'name' => $name ), 'acknowledger|' . (int) $incident->id );
		if ( is_wp_error( $ciphertext ) ) {
			return $ciphertext;
		}
		$now     = current_time( 'mysql', true );
		$updated = $wpdb->query(
			$wpdb->prepare(
				"UPDATE `" . esc_sql( $this->db->table( 'incidents' ) ) . "` SET first_acknowledged_at = %s, first_acknowledged_by = %s, acknowledger_ciphertext = %s, status = CASE WHEN status = 'active' THEN 'acknowledged' ELSE status END, escalation_due_at = NULL, updated_at = %s WHERE id = %d AND first_acknowledged_at IS NULL", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$now,
				$role,
				$ciphertext,
				$now,
				(int) $incident->id
			)
		);
		if ( false === $updated ) {
			return new WP_Error( 'acknowledgement_failed', __( 'The acknowledgement could not be recorded.', 'avenra-halo-v2' ) );
		}
		if ( 0 === $updated ) {
			return array( 'message' => __( 'This incident was already acknowledged. The first acknowledgement remains authoritative.', 'avenra-halo-v2' ) );
		}

		$this->append_event( (int) $incident->id, 'first_acknowledgement', $role, $metadata );
		return array( 'message' => $this->is_test_incident( $incident ) ? __( 'Test incident acknowledged. No real emergency action is available in drill mode.', 'avenra-halo-v2' ) : __( 'Acknowledged. Please now attempt to contact the rider and record the result.', 'avenra-halo-v2' ) );
	}

	/** @return array<string,string>|WP_Error */
	private function perform_responder_action( object $incident, string $role, string $action ): array|WP_Error {
		global $wpdb;

		$incident_id = (int) $incident->id;
		$safety_lock = null;
		if ( 'alert_next_of_kin' === $action ) {
			$safety_lock = $this->db->acquire_advisory_lock( 'emergency-safety-consent', (string) ( $incident->customer_id ?? 0 ), 2 );
			if ( ! $safety_lock ) {
				return new WP_Error( 'emergency_safety_consent_busy', __( 'The rider\'s safety choices are being updated. Refresh and retry before contacting the next of kin.', 'avenra-halo-v2' ) );
			}
		}
		$action_lock = $this->db->acquire_advisory_lock( 'emergency-incident-action', (string) $incident_id, 2 );
		if ( ! $action_lock ) {
			if ( $safety_lock ) {
				$this->db->release_advisory_lock( $safety_lock );
			}
			return new WP_Error( 'emergency_action_busy', __( 'Another responder update is being recorded. Refresh the incident before trying again.', 'avenra-halo-v2' ) );
		}
		try {
		$incident = $this->incident_by_id( $incident_id );
		if ( ! $incident ) {
			return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
		}
		if ( $this->is_test_incident( $incident ) ) {
			if ( 'test_complete' !== $action ) {
				return new WP_Error( 'test_action_blocked', __( 'This is a protected test exercise. Calling 999, contacting the rider and alerting next of kin are disabled.', 'avenra-halo-v2' ) );
			}
			if ( in_array( (string) $incident->status, array( 'resolved', 'cancelled', 'false_alarm' ), true ) ) {
				return array( 'message' => __( 'This test exercise is already complete.', 'avenra-halo-v2' ) );
			}
			$now = current_time( 'mysql', true );
			if ( false === $wpdb->update( $this->db->table( 'incidents' ), array( 'status' => 'resolved', 'resolved_at' => $now, 'escalation_due_at' => null, 'updated_at' => $now ), array( 'id' => (int) $incident->id ) ) ) {
				return new WP_Error( 'test_complete_failed', __( 'The test exercise could not be completed.', 'avenra-halo-v2' ) );
			}
			$this->append_event( (int) $incident->id, 'test_complete', $role, array( 'real_world_action' => false ) );
			$this->append_event( (int) $incident->id, 'resolution', $role, array( 'result' => 'test_complete' ) );
			return array( 'message' => __( 'Test exercise completed. No emergency services or next of kin were contacted.', 'avenra-halo-v2' ) );
		}
		if ( ! in_array( (string) $incident->status, array( 'active', 'acknowledged' ), true ) || empty( $incident->activated_at ) ) {
			return new WP_Error( 'emergency_incident_not_activated', __( 'This incident is still inside the rider cancellation window and cannot accept response actions.', 'avenra-halo-v2' ) );
		}
		if ( ! $incident || null === $incident->first_acknowledged_at ) {
			return new WP_Error( 'acknowledgement_required', __( 'A responder must acknowledge the incident before recording further actions.', 'avenra-halo-v2' ) );
		}
		$is_known_role = str_starts_with( $role, 'wp_' ) || in_array( $role, array( 'primary', 'backup' ), true );
		if ( ! $is_known_role || ! hash_equals( (string) $incident->first_acknowledged_by, $role ) ) {
			return new WP_Error( 'authoritative_responder_required', __( 'Only the responder who recorded the first acknowledgement can update this incident.', 'avenra-halo-v2' ) );
		}
		if ( in_array( (string) $incident->status, array( 'cancelled', 'false_alarm', 'resolved' ), true ) ) {
			return new WP_Error( 'emergency_incident_closed', __( 'This incident is already closed and cannot accept further response actions.', 'avenra-halo-v2' ) );
		}
		$now = current_time( 'mysql', true );
		switch ( $action ) {
			case 'rider_no_answer':
			case 'rider_confirmed':
				$result = 'rider_confirmed' === $action ? 'accident_confirmed' : 'no_answer';
				if ( false === $wpdb->update( $this->db->table( 'incidents' ), array( 'rider_call_result' => $result, 'updated_at' => $now ), array( 'id' => (int) $incident->id ) ) ) {
					return new WP_Error( 'rider_call_update_failed', __( 'The rider-call result could not be saved.', 'avenra-halo-v2' ) );
				}
				$this->append_event( (int) $incident->id, 'rider_call_result', $role, array( 'result' => $result ) );
				return array( 'message' => 'accident_confirmed' === $result ? __( 'The rider confirmed that an accident occurred.', 'avenra-halo-v2' ) : __( 'No answer from the rider was recorded.', 'avenra-halo-v2' ) );

			case 'false_alarm':
				$media_lock = $this->db->acquire_advisory_lock( 'incident-media-upload', (string) $incident->id, 3 );
				if ( ! $media_lock ) {
					return new WP_Error( 'false_alarm_media_busy', __( 'Incident evidence is being secured. Retry the false-alarm resolution immediately.', 'avenra-halo-v2' ), array( 'retryable' => true ) );
				}
				try {
					$false_alarm_updated = $wpdb->query(
						$wpdb->prepare(
							"UPDATE `" . esc_sql( $this->db->table( 'incidents' ) ) . "` SET status = 'false_alarm', resolved_at = %s, escalation_due_at = NULL, updated_at = %s WHERE id = %d AND status IN ('active','acknowledged')",
							$now,
							$now,
							(int) $incident->id
						)
					); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					if ( 1 === (int) $false_alarm_updated && class_exists( 'Avenra_Halo_V2_Incident_Media' ) ) {
						Avenra_Halo_V2_Incident_Media::instance()->purge_incident_under_upload_lock( (int) $incident->id, 'false_alarm' );
					}
				} finally {
					$this->db->release_advisory_lock( $media_lock );
				}
				if ( 1 !== (int) $false_alarm_updated ) {
					return new WP_Error( 'false_alarm_failed', __( 'The false-alarm resolution could not be saved.', 'avenra-halo-v2' ) );
				}
				$this->append_event( (int) $incident->id, 'false_alarm', $role );
				$this->append_event( (int) $incident->id, 'resolution', $role, array( 'result' => 'false_alarm' ) );
				return array( 'message' => __( 'The incident was resolved as a false alarm.', 'avenra-halo-v2' ) );

			case 'emergency_services_called':
				$updated = $wpdb->query(
					$wpdb->prepare(
						'UPDATE `' . esc_sql( $this->db->table( 'incidents' ) ) . '` SET emergency_services_called_at = %s, updated_at = %s WHERE id = %d AND emergency_services_called_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						$now,
						$now,
						(int) $incident->id
					)
				);
				if ( false === $updated ) {
					return new WP_Error( 'emergency_call_update_failed', __( 'The 999 call could not be recorded.', 'avenra-halo-v2' ) );
				}
				if ( 1 === $updated ) {
					$this->append_event( (int) $incident->id, '999_called', $role, array( 'human_action' => true ) );
				}
				return array( 'message' => __( 'The human-reported 999 call was recorded. Halo has not called emergency services.', 'avenra-halo-v2' ) );

			case 'alert_next_of_kin':
				if ( null === $incident->emergency_services_called_at ) {
					return new WP_Error( 'emergency_call_required', __( 'Record that a person has called 999 before alerting the next of kin.', 'avenra-halo-v2' ) );
				}
				return $this->notify_next_of_kin( $incident, $role );

			case 'handover_complete':
				if ( null === $incident->emergency_services_called_at ) {
					return new WP_Error( 'emergency_call_required', __( 'Record the completed 999 call before closing this incident as handed over. Use false alarm when no emergency response is required.', 'avenra-halo-v2' ) );
				}
				if ( false === $wpdb->update( $this->db->table( 'incidents' ), array( 'status' => 'resolved', 'resolved_at' => $now, 'escalation_due_at' => null, 'updated_at' => $now ), array( 'id' => (int) $incident->id ) ) ) {
					return new WP_Error( 'handover_failed', __( 'The handover could not be recorded.', 'avenra-halo-v2' ) );
				}
				$this->append_event( (int) $incident->id, 'handover_complete', $role );
				$this->append_event( (int) $incident->id, 'resolution', $role, array( 'result' => 'handover_complete' ) );
				return array( 'message' => __( 'Handover was recorded and the incident was resolved.', 'avenra-halo-v2' ) );
		}

		return new WP_Error( 'emergency_action_invalid', __( 'That Emergency Assist action is unavailable.', 'avenra-halo-v2' ) );
			} finally {
				$this->db->release_advisory_lock( $action_lock );
				if ( $safety_lock ) {
					$this->db->release_advisory_lock( $safety_lock );
				}
			}
	}

	/** @return array<string,string>|WP_Error */
	private function notify_next_of_kin( object $incident, string $role ): array|WP_Error {
		global $wpdb;
		if ( $this->is_test_incident( $incident ) ) {
			return new WP_Error( 'test_action_blocked', __( 'Next-of-kin contact is disabled for every test exercise.', 'avenra-halo-v2' ) );
		}

		$lock = $this->db->acquire_advisory_lock( 'emergency-nok', (string) $incident->id, 2 );
		if ( ! $lock ) {
			return new WP_Error( 'nok_notification_busy', __( 'The next-of-kin notification is already being processed.', 'avenra-halo-v2' ) );
		}
		try {
			$incident = $this->incident_by_id( (int) $incident->id );
			if ( ! $incident ) {
				return new WP_Error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ) );
			}
			if ( $this->is_test_incident( $incident ) ) {
				return new WP_Error( 'test_action_blocked', __( 'Next-of-kin contact is disabled for every test exercise.', 'avenra-halo-v2' ) );
			}
			if ( ! in_array( (string) $incident->status, array( 'active', 'acknowledged' ), true ) || empty( $incident->activated_at ) ) {
				return new WP_Error( 'emergency_incident_closed', __( 'This incident is not active and cannot alert the next of kin.', 'avenra-halo-v2' ) );
			}
			if ( ! hash_equals( (string) $incident->first_acknowledged_by, $role ) ) {
				return new WP_Error( 'authoritative_responder_required', __( 'Only the responder who recorded the first acknowledgement can alert the next of kin.', 'avenra-halo-v2' ) );
			}
			if ( null === $incident->emergency_services_called_at ) {
				return new WP_Error( 'emergency_call_required', __( 'Record that a person has called 999 before alerting the next of kin.', 'avenra-halo-v2' ) );
			}
			if ( 'accepted' === (string) $incident->nok_notification_status ) {
				return array( 'message' => __( 'The next-of-kin notification was already accepted.', 'avenra-halo-v2' ) );
			}
			if ( 'attempting' === (string) $incident->nok_notification_status ) {
				return new WP_Error( 'nok_notification_busy', __( 'The next-of-kin notification is already being processed.', 'avenra-halo-v2' ) );
			}
			if ( false === $wpdb->update( $this->db->table( 'incidents' ), array( 'nok_notification_status' => 'attempting', 'updated_at' => current_time( 'mysql', true ) ), array( 'id' => (int) $incident->id ) ) ) {
				return new WP_Error( 'nok_notification_failed', __( 'The next-of-kin notification state could not be saved.', 'avenra-halo-v2' ) );
			}
		} finally {
			$this->db->release_advisory_lock( $lock );
		}

		$customer = $this->db->customer_by_id( (int) $incident->customer_id );
		if ( ! $customer || empty( $customer->nok_mobile ) || ! $this->has_nok_alert_consent( (int) $incident->customer_id ) ) {
			$this->record_nok_result( (int) $incident->id, $role, false, 'nok_not_enabled' );
			return new WP_Error( 'nok_not_enabled', __( 'This rider has not enabled a next-of-kin notification.', 'avenra-halo-v2' ) );
		}
		$snapshot = $this->redact_snapshot_for_current_consent( $this->snapshot_for_incident( $incident ), (int) $incident->customer_id );
		$location = is_array( $snapshot['location'] ?? null ) ? $snapshot['location'] : array();
		$impact   = is_array( $snapshot['impact'] ?? null ) ? $snapshot['impact'] : array();
		$payload  = array(
			'event_id'             => sanitize_text_field( (string) $incident->client_event_id ),
			'occurred_at'          => gmdate( DATE_RFC3339, strtotime( (string) $incident->occurred_at . ' UTC' ) ?: time() ),
			'lat'                  => $location['lat'] ?? null,
			'lng'                  => $location['lng'] ?? null,
			'speed'                => $impact['speed_mph'] ?? 0,
			'peak_g_force'         => $impact['peak_g_force'] ?? 0,
			'emergency_assist'     => true,
			'emergency_services_called_at' => $this->rfc3339( $incident->emergency_services_called_at ),
		);

		$result = null;
		try {
			$result = apply_filters( 'avenra_halo_v2_safety_alert_result', null, 'crash', $payload, $customer );
		} catch ( Throwable $error ) {
			$result = new WP_Error( 'nok_provider_exception' );
		}
		$accepted = false;
		$code     = 'provider_failed';
		if ( is_array( $result ) ) {
			$accepted = true === ( $result['accepted'] ?? null ) || true === ( $result['sent'] ?? null ) || true === ( $result['success'] ?? null );
			$code     = $accepted ? 'accepted' : sanitize_key( (string) ( $result['code'] ?? 'provider_rejected' ) );
		} elseif ( null === $result ) {
			try {
				$result = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch( 'send_nok_crash_alert_v2', $payload, (int) $incident->customer_id );
			} catch ( Throwable $error ) {
				$result = new WP_Error( 'legacy_provider_exception' );
			}
			if ( is_array( $result ) ) {
				$accepted = ! empty( $result['success'] ) || 'ok' === ( $result['status'] ?? '' ) || ! empty( $result['data']['sent'] );
				$code     = $accepted ? 'accepted' : 'legacy_rejected';
			} else {
				$code = 'provider_unavailable';
			}
		} elseif ( is_wp_error( $result ) ) {
			$code = sanitize_key( $result->get_error_code() ) ?: 'provider_unavailable';
		}

		$this->record_nok_result( (int) $incident->id, $role, $accepted, $code );
		return $accepted
			? array( 'message' => __( 'The next-of-kin notification was accepted by the configured service.', 'avenra-halo-v2' ) )
			: new WP_Error( 'nok_notification_failed', __( 'The next-of-kin service did not accept the notification.', 'avenra-halo-v2' ) );
	}

	private function record_nok_result( int $incident_id, string $role, bool $accepted, string $code ): void {
		global $wpdb;
		$now = current_time( 'mysql', true );
		$wpdb->update(
			$this->db->table( 'incidents' ),
			array(
				'nok_notification_status' => $accepted ? 'accepted' : 'failed',
				'nok_notified_at'          => $accepted ? $now : null,
				'updated_at'               => $now,
			),
			array( 'id' => $incident_id )
		);
		$this->append_event( $incident_id, 'nok_notification_outcome', $role, array( 'accepted' => $accepted, 'safe_code' => sanitize_key( $code ) ) );
	}

	/** @param array{incident:object,role:string,session_token:string,expires_at:string} $session */
	private function render_dashboard( array $session ): void {
		global $wpdb;

		$incident = $this->incident_by_id( (int) $session['incident']->id );
		if ( ! $incident ) {
			$this->render_unavailable( 404 );
		}
		$open_key = 'avh2_em_open_' . (int) $incident->id . '_' . $session['role'] . '_' . substr( $this->token_hash( $session['session_token'] ), 0, 16 );
		if ( false === get_transient( $open_key ) ) {
			$this->append_event( (int) $incident->id, 'dashboard_open', $session['role'], array( 'attribution' => 'device_role' ) );
			set_transient( $open_key, 1, 5 * MINUTE_IN_SECONDS );
		}
		$events = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT event_type, actor_role, metadata_json, created_at FROM `' . esc_sql( $this->db->table( 'incident_events' ) ) . '` WHERE incident_id = %d ORDER BY created_at ASC, id ASC', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				(int) $incident->id
			),
			ARRAY_A
		);
		foreach ( $events as &$event ) {
			$metadata = json_decode( (string) ( $event['metadata_json'] ?? '' ), true );
			$event['metadata'] = is_array( $metadata ) ? $metadata : array();
			unset( $event['metadata_json'] );
		}
		unset( $event );

		$snapshot = $this->redact_snapshot_for_current_consent( $this->snapshot_for_incident( $incident ), (int) $incident->customer_id );
		$ack_name = '';
		if ( ! empty( $incident->acknowledger_ciphertext ) ) {
			$ack = $this->decrypt_value( (string) $incident->acknowledger_ciphertext, 'acknowledger|' . (int) $incident->id );
			$ack_name = is_array( $ack ) ? sanitize_text_field( (string) ( $ack['name'] ?? '' ) ) : '';
		}
		$notice_key = 'avh2_em_notice_' . substr( $this->token_hash( $session['session_token'] ), 0, 40 );
		$notice     = get_transient( $notice_key );
		delete_transient( $notice_key );

		try {
			$dashboard_nonce = base64_encode( random_bytes( 18 ) );
		} catch ( Throwable $error ) {
			$dashboard_nonce = wp_generate_password( 30, false, false );
		}
		$this->security_headers( true, $dashboard_nonce );
		$halo_emergency = array(
			'mode'                 => 'dashboard',
			'incident'             => $incident,
			'snapshot'             => $snapshot,
			'snapshot_unavailable' => empty( $snapshot ) && ! empty( $incident->snapshot_ciphertext ),
			'events'               => $events,
			'role'                 => $session['role'],
			'role_label'           => 'primary' === $session['role'] ? __( 'Primary response device', 'avenra-halo-v2' ) : __( 'Backup response device', 'avenra-halo-v2' ),
			'csrf'                 => $this->responder_csrf( $session['session_token'] ),
			'dashboard_url'        => $this->responder_dashboard_url( $incident, $session['role'] ),
			'acknowledger_name'    => $ack_name,
			'notice'               => is_array( $notice ) ? $notice : null,
			'map_url'              => $this->osm_url( $snapshot ),
			'route_points'         => $this->route_points( $snapshot ),
			'logo'                 => AVENRA_HALO_V2_LOGO_BLACK,
			'csp_nonce'            => $dashboard_nonce,
		);
		$this->include_template( $halo_emergency );
	}

	private function render_exchange_shell(): void {
		try {
			$nonce = base64_encode( random_bytes( 18 ) );
		} catch ( Throwable $error ) {
			$nonce = wp_generate_password( 30, false, false );
		}
		$this->security_headers( true, $nonce );
		$halo_emergency = array(
			'mode'           => 'exchange',
			'csp_nonce'      => $nonce,
			'exchange_nonce' => wp_create_nonce( 'avenra_halo_v2_emergency_exchange' ),
			'logo'           => AVENRA_HALO_V2_LOGO_BLACK,
		);
		$this->include_template( $halo_emergency );
	}

	private function render_unavailable( int $status ): void {
		status_header( $status );
		$this->security_headers( false );
		$halo_emergency = array(
			'mode'    => 'unavailable',
			'message' => __( 'This private Emergency Assist link is unavailable or has expired.', 'avenra-halo-v2' ),
			'logo'    => AVENRA_HALO_V2_LOGO_BLACK,
		);
		$this->include_template( $halo_emergency );
	}

	/** @param array<string,mixed> $context */
	private function include_template( array $context ): void {
		$template = AVENRA_HALO_V2_DIR . 'templates/emergency-incident.php';
		if ( ! file_exists( $template ) ) {
			status_header( 503 );
			exit;
		}
		$halo_emergency = $context;
		include $template;
		exit;
	}

	private function security_headers( bool $allow_script, string $nonce = '' ): void {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		if ( ! defined( 'DONOTROCKETOPTIMIZE' ) ) {
			define( 'DONOTROCKETOPTIMIZE', true );
		}
		nocache_headers();
		header( 'Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0', true );
		header( 'CDN-Cache-Control: no-store', true );
		header( 'Cloudflare-CDN-Cache-Control: no-store', true );
		header( 'Surrogate-Control: no-store', true );
		header( 'Referrer-Policy: no-referrer', true );
		header( 'X-Frame-Options: DENY', true );
		header( 'X-Content-Type-Options: nosniff', true );
		header( 'X-Robots-Tag: noindex, nofollow, noarchive, nosnippet', true );
		header( 'Permissions-Policy: accelerometer=(), camera=(), gyroscope=(), microphone=(), geolocation=(), payment=(), usb=()', true );
		$script = $allow_script && '' !== $nonce ? "script-src 'nonce-" . $nonce . "'; connect-src 'self'; " : "script-src 'none'; ";
		header( "Content-Security-Policy: default-src 'none'; " . $script . "style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'", true );
		header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ), true );
	}

	/** @param array<string,mixed> $input @return array<string,mixed>|WP_Error */
	private function build_snapshot( int $customer_id, string $event_id, array $input ): array|WP_Error {
		global $wpdb;

		$customer = $this->db->customer_by_id( $customer_id );
		if ( ! $customer ) {
			return new WP_Error( 'emergency_customer_missing', __( 'The Halo customer could not be found.', 'avenra-halo-v2' ) );
		}
		$assist_settings = $this->get_assist_settings( $customer_id );
		$medical_consent = ! empty( $assist_settings['medical_consent_current'] );
		$nok_consent     = ! empty( $assist_settings['nok_alerts_enabled'] );
		$order           = null;
		$requested_vehicle_id = absint( $input['vehicle_id'] ?? $input['vehicle_order_id'] ?? 0 );
		if ( $this->db->table_exists( $this->db->table( 'orders' ) ) ) {
			if ( $requested_vehicle_id > 0 ) {
				$order = $wpdb->get_row(
					$wpdb->prepare(
						'SELECT * FROM `' . esc_sql( $this->db->table( 'orders' ) ) . '` WHERE id = %d AND customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						$requested_vehicle_id,
						$customer_id
					)
				);
			}
			if ( 0 === $requested_vehicle_id ) {
				$order = $wpdb->get_row(
					$wpdb->prepare(
						'SELECT * FROM `' . esc_sql( $this->db->table( 'orders' ) ) . '` WHERE customer_id = %d ORDER BY id DESC LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						$customer_id
					)
				);
			}
		}

		$location      = is_array( $input['location'] ?? null ) ? $input['location'] : ( is_array( $input['position'] ?? null ) ? $input['position'] : array() );
		$impact        = is_array( $input['impact'] ?? null ) ? $input['impact'] : ( is_array( $input['incident'] ?? null ) ? $input['incident'] : array() );
		$device        = is_array( $input['device'] ?? null ) ? $input['device'] : array();
		$device_state  = is_array( $input['device_state'] ?? null ) ? $input['device_state'] : ( is_array( $input['impact_device_state'] ?? null ) ? $input['impact_device_state'] : array() );
		$state_network = is_array( $device_state['network'] ?? null ) ? $device_state['network'] : array();
		$network       = array_merge( $state_network, is_array( $input['network'] ?? null ) ? $input['network'] : array() );
		$acceleration  = is_array( $input['acceleration'] ?? null ) ? $input['acceleration'] : ( is_array( $impact['acceleration'] ?? null ) ? $impact['acceleration'] : array() );
		$axes          = is_array( $impact['axes'] ?? null ) ? $impact['axes'] : ( is_array( $input['axes'] ?? null ) ? $input['axes'] : $acceleration );
		$gravity       = is_array( $impact['gravity'] ?? null ) ? $impact['gravity'] : ( is_array( $input['gravity'] ?? null ) ? $input['gravity'] : array() );
		$route         = $input['recent_route'] ?? $input['recent_route_points'] ?? $input['route'] ?? $input['route_trace'] ?? array();
		$telemetry     = $input['recent_telemetry'] ?? $input['telemetry'] ?? array();
		$occurrence    = $this->input_occurrence( $input );
		$speed         = $this->number_or_null( $input['speed_mph'] ?? $input['speed'] ?? $impact['speed_mph'] ?? $impact['speed'] ?? null );
		$prior_speed   = $this->number_or_null( $input['previous_speed_mph'] ?? $input['prior_speed_mph'] ?? $input['speed_before_mph'] ?? $impact['previous_speed_mph'] ?? $impact['prior_speed_mph'] ?? $impact['speed_before_mph'] ?? null );
		$top_speed     = $this->number_or_null( $input['top_speed_mph'] ?? $impact['top_speed_mph'] ?? null );
		$peak_g_force  = $this->number_or_null( $input['peak_g_force'] ?? $impact['peak_g_force'] ?? $impact['peak_g'] ?? null );
		$location_time = $location['timestamp'] ?? $location['captured_at'] ?? $location['recorded_at'] ?? $location['recordedAt'] ?? $location['at'] ?? $input['location_timestamp'] ?? $input['position_at'] ?? $input['gps_timestamp'] ?? $occurrence;
		$phone_battery = is_array( $input['phone_battery'] ?? null ) ? $input['phone_battery'] : ( is_array( $device_state['battery'] ?? null ) ? $device_state['battery'] : array() );
		$client_ride_id = $this->text( sanitize_text_field( (string) ( $input['client_ride_id'] ?? $input['ride_id'] ?? '' ) ), 80 );
		$vehicle_id    = is_object( $order ) ? (int) $order->id : 0;

		$snapshot = array(
			'schema'          => 1,
			'client_event_id' => $event_id,
			'captured_at'     => gmdate( DATE_RFC3339 ),
			'consents'        => array(
				'assist'         => ! empty( $assist_settings['consent_current'] ),
				'medical'        => $medical_consent,
				'next_of_kin'    => $nok_consent,
				'consent_version'=> (string) $assist_settings['consent_version'],
				'medical_consent_version' => (string) $assist_settings['medical_consent_version'],
			),
			'ride_context'     => array(
				'client_ride_id' => $client_ride_id,
				'vehicle_id'     => $vehicle_id ?: null,
			),
			'rider'           => array(
				'name'         => $this->object_value( $customer, array( 'full_name', 'name', 'customer_name' ) ),
				'mobile'       => $this->object_value( $customer, array( 'mobile_number', 'mobile', 'phone_number', 'telephone' ) ),
				'email'        => sanitize_email( (string) ( $customer->email_address ?? $customer->email ?? '' ) ),
				'home_address' => $this->object_value( $customer, array( 'full_address', 'home_address', 'address', 'address_line_1' ) ),
				'postcode'     => $this->object_value( $customer, array( 'postcode', 'postal_code' ) ),
			),
			'medical'         => $medical_consent ? array(
				'date_of_birth' => $this->object_value( $customer, array( 'date_of_birth', 'dob' ) ),
				'blood_type'    => $this->object_value( $customer, array( 'blood_type', 'blood_group' ) ),
				'weight_kg'     => $this->number_or_null( $customer->weight_kg ?? null ),
				'notes'         => $this->text( sanitize_textarea_field( (string) ( $customer->medical_notes ?? '' ) ), 2000 ),
			) : array(),
			'next_of_kin'     => $nok_consent ? array(
				'name'         => $this->object_value( $customer, array( 'nok_name' ) ),
				'mobile'       => $this->object_value( $customer, array( 'nok_mobile' ) ),
				'relationship' => $this->object_value( $customer, array( 'nok_relation' ) ),
			) : array(),
			'bike'            => is_object( $order ) ? array(
				'order_id'     => (int) ( $order->id ?? 0 ),
				'model'        => $this->object_value( $order, array( 'model', 'model_name', 'bike_model', 'motorcycle_model' ) ),
				'registration' => $this->object_value( $order, array( 'registration_plate', 'registration', 'registration_number', 'reg_number', 'vehicle_registration' ) ),
				'colour'       => $this->object_value( $order, array( 'color', 'colour', 'paint_color', 'paint_colour', 'bike_colour' ) ),
				'vin'          => $this->object_value( $order, array( 'vin', 'vin_number', 'chassis_number' ) ),
				'ev_hv_warning'=> __( 'Electric motorcycle: treat damaged orange cables, battery enclosure, smoke, heat or unusual odour as a high-voltage hazard. Do not touch or charge the vehicle.', 'avenra-halo-v2' ),
			) : array( 'ev_hv_warning' => __( 'Electric motorcycle: treat damaged orange cables, battery enclosure, smoke, heat or unusual odour as a high-voltage hazard. Do not touch or charge the vehicle.', 'avenra-halo-v2' ) ),
				'location'        => array(
					'timestamp'  => gmdate( DATE_RFC3339, strtotime( $this->mysql_time( $location_time ) . ' UTC' ) ?: time() ),
					'lat'        => $this->coordinate( $input['lat'] ?? $input['latitude'] ?? $location['lat'] ?? $location['latitude'] ?? null, -90, 90 ),
					'lng'        => $this->coordinate( $input['lng'] ?? $input['longitude'] ?? $location['lng'] ?? $location['longitude'] ?? null, -180, 180 ),
					'address'    => $this->text( sanitize_text_field( (string) ( $input['address'] ?? $location['address'] ?? '' ) ), 300 ),
					'accuracy_m' => $this->number_or_null( $input['accuracy_m'] ?? $input['accuracy'] ?? $location['accuracy_m'] ?? $location['accuracy'] ?? null ),
					'altitude_m' => $this->number_or_null( $input['altitude_m'] ?? $input['altitude'] ?? $location['altitude_m'] ?? $location['altitude'] ?? null ),
					'heading'    => $this->number_or_null( $input['heading'] ?? $location['heading'] ?? null ),
					'movement'   => $this->text( sanitize_text_field( (string) ( $input['movement'] ?? $location['movement'] ?? '' ) ), 80 ),
					'source'     => $this->text( sanitize_text_field( (string) ( $location['source'] ?? $input['location_source'] ?? '' ) ), 80 ),
				),
				'impact'          => array(
					'occurred_at'          => gmdate( DATE_RFC3339, strtotime( $this->mysql_time( $occurrence ) . ' UTC' ) ?: time() ),
					'speed_mph'            => $speed,
					'prior_speed_mph'      => $prior_speed,
					'top_speed_mph'        => $top_speed,
					'peak_g_force'         => $peak_g_force,
					'axes'                 => array(
						'x' => $this->number_or_null( $axes['x'] ?? $input['axis_x'] ?? null ),
						'y' => $this->number_or_null( $axes['y'] ?? $input['axis_y'] ?? null ),
						'z' => $this->number_or_null( $axes['z'] ?? $input['axis_z'] ?? null ),
					),
					'gravity'              => array(
						'x'         => $this->number_or_null( $gravity['x'] ?? $impact['gravity_x'] ?? $input['gravity_x'] ?? null ),
						'y'         => $this->number_or_null( $gravity['y'] ?? $impact['gravity_y'] ?? $input['gravity_y'] ?? null ),
						'z'         => $this->number_or_null( $gravity['z'] ?? $impact['gravity_z'] ?? $input['gravity_z'] ?? null ),
						'magnitude' => $this->number_or_null( $gravity['magnitude'] ?? $impact['gravity_magnitude'] ?? $input['gravity_magnitude'] ?? ( is_numeric( $impact['gravity'] ?? null ) ? $impact['gravity'] : ( is_numeric( $input['gravity'] ?? null ) ? $input['gravity'] : null ) ) ),
					),
					'resultant_g'          => $this->number_or_null( $input['resultant_g'] ?? $acceleration['resultant_g'] ?? $acceleration['resultantG'] ?? $peak_g_force ),
					'includes_gravity'     => $this->truthy( $acceleration['includesGravity'] ?? $acceleration['includes_gravity'] ?? false ),
					'source'               => $this->text( sanitize_text_field( (string) ( $impact['source'] ?? $input['impact_source'] ?? $input['source'] ?? ( $this->truthy( $acceleration['includesGravity'] ?? $acceleration['includes_gravity'] ?? false ) ? 'acceleration_including_gravity' : ( $acceleration ? 'linear_acceleration' : '' ) ) ) ), 80 ),
					'lean_degrees'         => $this->number_or_null( $impact['lean_degrees'] ?? $impact['lean'] ?? $input['lean_degrees'] ?? $input['lean'] ?? null ),
					'max_lean_left'        => $this->number_or_null( $impact['max_lean_left'] ?? $input['max_lean_left'] ?? null ),
					'max_lean_right'       => $this->number_or_null( $impact['max_lean_right'] ?? $input['max_lean_right'] ?? null ),
					'heading'              => $this->number_or_null( $impact['heading'] ?? $input['heading'] ?? null ),
					'estimated_orientation'=> $this->text( sanitize_text_field( (string) ( $impact['estimated_orientation'] ?? $impact['orientation'] ?? $input['estimated_orientation'] ?? '' ) ), 80 ),
					'movement'             => $this->text( sanitize_text_field( (string) ( $impact['movement'] ?? $input['movement'] ?? '' ) ), 80 ),
					'severity'             => $this->severity_tier( $peak_g_force, $speed, $prior_speed ),
				),
				'device'          => array(
					'battery'           => $this->text( sanitize_text_field( (string) ( $device['battery'] ?? $input['battery'] ?? '' ) ), 80 ),
					'phone_battery'     => array(
						'level_percent' => $this->number_or_null( $phone_battery['levelPercent'] ?? $phone_battery['level_percent'] ?? $phone_battery['level'] ?? null ),
						'charging'       => $this->truthy( $phone_battery['charging'] ?? false ),
					),
					'platform'          => $this->text( sanitize_text_field( (string) ( $device['platform'] ?? '' ) ), 80 ),
					'model'             => $this->text( sanitize_text_field( (string) ( $device['model'] ?? '' ) ), 80 ),
					'visibility'        => $this->text( sanitize_key( (string) ( $device_state['visibility'] ?? '' ) ), 24 ),
					'screen_orientation'=> $this->text( sanitize_text_field( (string) ( $device_state['screenOrientation'] ?? $device_state['screen_orientation'] ?? '' ) ), 48 ),
				),
				'network'         => array(
					'online'          => $this->truthy( $network['online'] ?? $device_state['online'] ?? $input['online'] ?? false ),
					'connection_type' => $this->text( sanitize_text_field( (string) ( $network['connection_type'] ?? $network['type'] ?? '' ) ), 40 ),
					'effective_type'  => $this->text( sanitize_text_field( (string) ( $network['effective_type'] ?? $network['effectiveType'] ?? '' ) ), 40 ),
					'downlink_mbps'   => $this->number_or_null( $network['downlink_mbps'] ?? $network['downlinkMbps'] ?? $network['downlink'] ?? null ),
					'rtt_ms'          => $this->number_or_null( $network['rtt_ms'] ?? $network['rttMs'] ?? $network['rtt'] ?? null ),
					'save_data'       => $this->truthy( $network['save_data'] ?? $network['saveData'] ?? false ),
				),
				'recent_route'    => $this->normalise_route( $route ),
				'recent_telemetry'=> $this->normalise_telemetry( $telemetry ),
				'planned_route'   => $this->normalise_planned_route( $input['planned_route'] ?? $input['plannedRoute'] ?? null ),
			);
		// The impact position is immutable evidence. `location` may subsequently
		// move as the rider device sends live updates, but must never overwrite
		// where the collision was detected.
		$snapshot['impact_location'] = $snapshot['location'];

		/** Server integrations may add already-sanitised, incident-specific fields. */
		try {
			$filtered = apply_filters( 'avenra_halo_v2_emergency_snapshot', $snapshot, $customer_id, $event_id, $input );
		} catch ( Throwable $error ) {
			return new WP_Error( 'emergency_snapshot_failed', __( 'Emergency Assist could not prepare the incident snapshot.', 'avenra-halo-v2' ) );
		}
		$filtered = is_array( $filtered ) ? $this->normalise_value( $filtered, 0 ) : $snapshot;
		if ( ! $medical_consent ) {
			$filtered['medical'] = array();
		}
		if ( ! $nok_consent ) {
			$filtered['next_of_kin'] = array();
		}
		return $filtered;
	}

	/** @return array<string,mixed> */
	private function snapshot_for_incident( object $incident ): array {
		if ( empty( $incident->snapshot_ciphertext ) ) {
			return array();
		}
		$value = $this->decrypt_value( (string) $incident->snapshot_ciphertext, $this->snapshot_aad( (int) $incident->customer_id, (string) $incident->client_event_id ) );
		return is_array( $value ) ? $value : array();
	}

	/**
	 * Defense in depth for every human-facing briefing. Stored redaction remains
	 * authoritative, but current consent is checked again before rendering so a
	 * retained or legacy snapshot cannot expose withdrawn medical or NOK data.
	 *
	 * @param array<string,mixed> $snapshot
	 * @return array<string,mixed>
	 */
	private function redact_snapshot_for_current_consent( array $snapshot, int $customer_id ): array {
		$settings = $this->get_assist_settings( $customer_id );
		$medical_allowed = ! empty( $settings['medical_consent_current'] );
		$nok_allowed = ! empty( $settings['nok_alerts_enabled'] );
		if ( ! $medical_allowed ) {
			$snapshot['medical'] = array();
		}
		if ( ! $nok_allowed ) {
			$snapshot['next_of_kin'] = array();
		}
		if ( is_array( $snapshot['consents'] ?? null ) ) {
			$snapshot['consents']['medical']     = $medical_allowed;
			$snapshot['consents']['next_of_kin'] = $nok_allowed;
		}
		return $snapshot;
	}

	/** @param array<string,mixed> $input @return string|WP_Error */
	private function merged_snapshot_ciphertext( object $incident, array $input ): string|WP_Error {
		if ( ! empty( $incident->snapshot_redacted_at ) ) {
			return new WP_Error( 'emergency_snapshot_redacted', __( 'The retained incident snapshot can no longer be updated.', 'avenra-halo-v2' ) );
		}
		$existing = $this->snapshot_for_incident( $incident );
		if ( ! empty( $incident->snapshot_ciphertext ) && empty( $existing ) ) {
			return new WP_Error( 'emergency_snapshot_unavailable', __( 'The protected incident snapshot could not be opened safely.', 'avenra-halo-v2' ) );
		}
		$fresh = $this->build_snapshot( (int) $incident->customer_id, (string) $incident->client_event_id, $input );
		if ( is_wp_error( $fresh ) ) {
			return $fresh;
		}

		$existing_location = is_array( $existing['location'] ?? null ) ? $existing['location'] : array();
		$merged = $this->merge_snapshot_values( $existing, $fresh );
		// Consent-bound identity fields are authoritative, including empty
		// sections after revocation. The generic merge intentionally skips empty
		// arrays and therefore must not decide retention for these fields.
		foreach ( array( 'consents', 'rider', 'medical', 'next_of_kin' ) as $section ) {
			if ( array_key_exists( $section, $fresh ) ) {
				$merged[ $section ] = $fresh[ $section ];
			}
		}
		if ( ! $this->has_any_key( $input, array( 'vehicle_id', 'vehicle_order_id' ) ) && isset( $existing['bike'] ) ) {
			$merged['bike'] = $existing['bike'];
		}
		if ( ! $this->has_any_key( $input, array( 'vehicle_id', 'vehicle_order_id', 'client_ride_id', 'ride_id' ) ) && isset( $existing['ride_context'] ) ) {
			$merged['ride_context'] = $existing['ride_context'];
		}
		if ( ! $this->input_has_location( $input ) && isset( $existing['location'] ) ) {
			$merged['location'] = $existing['location'];
		} elseif ( $this->input_has_location( $input ) && is_array( $fresh['location'] ?? null ) ) {
			$incoming_location = $fresh['location'];
			$old_lat = $this->coordinate( $existing_location['lat'] ?? null, -90, 90 );
			$old_lng = $this->coordinate( $existing_location['lng'] ?? null, -180, 180 );
			$new_lat = $this->coordinate( $incoming_location['lat'] ?? null, -90, 90 );
			$new_lng = $this->coordinate( $incoming_location['lng'] ?? null, -180, 180 );
			$coordinates_changed = null !== $old_lat && null !== $old_lng && null !== $new_lat && null !== $new_lng
				&& ( abs( $old_lat - $new_lat ) > 0.00001 || abs( $old_lng - $new_lng ) > 0.00001 );
			if ( $coordinates_changed ) {
				// Never pair a new coordinate with the previous road/postcode. A
				// fresh reverse-geocode job may populate this address afterwards.
				$incoming_location['address'] = '';
				$merged['location'] = $incoming_location;
			} else {
				$merged['location'] = $this->merge_snapshot_values( $existing_location, $incoming_location );
			}
		}
		if ( isset( $existing['impact_location'] ) ) {
			$merged['impact_location'] = $existing['impact_location'];
		} elseif ( $existing_location ) {
			$merged['impact_location'] = $existing_location;
		} elseif ( isset( $fresh['impact_location'] ) ) {
			$merged['impact_location'] = $fresh['impact_location'];
		}
		if ( ! $this->input_has_impact( $input ) && isset( $existing['impact'] ) ) {
			$merged['impact'] = $existing['impact'];
		} elseif ( null === $this->input_occurrence( $input ) && isset( $existing['impact']['occurred_at'] ) ) {
			$merged['impact']['occurred_at'] = $existing['impact']['occurred_at'];
		}
		if ( ! $this->has_any_key( $input, array( 'device', 'device_state', 'impact_device_state', 'phone_battery', 'battery' ) ) && isset( $existing['device'] ) ) {
			$merged['device'] = $existing['device'];
		}
		if ( ! $this->has_any_key( $input, array( 'network', 'device_state', 'impact_device_state', 'online', 'connection_type', 'effective_type' ) ) && isset( $existing['network'] ) ) {
			$merged['network'] = $existing['network'];
		}

		if ( $this->has_any_key( $input, array( 'recent_route', 'recent_route_points', 'route', 'route_trace' ) ) ) {
			$merged['recent_route'] = $this->merge_route_points(
				$existing['recent_route'] ?? array(),
				$fresh['recent_route'] ?? array()
			);
		} elseif ( isset( $existing['recent_route'] ) ) {
			$merged['recent_route'] = $existing['recent_route'];
		}
		if ( $this->has_any_key( $input, array( 'recent_telemetry', 'telemetry' ) ) ) {
			$merged['recent_telemetry'] = $this->merge_telemetry_samples(
				$existing['recent_telemetry'] ?? array(),
				$fresh['recent_telemetry'] ?? array()
			);
		} elseif ( isset( $existing['recent_telemetry'] ) ) {
			$merged['recent_telemetry'] = $existing['recent_telemetry'];
		}

		$merged['captured_at'] = gmdate( DATE_RFC3339 );
		return $this->encrypt_value( $merged, $this->snapshot_aad( (int) $incident->customer_id, (string) $incident->client_event_id ) );
	}

	/** @param array<string,mixed> $base @param array<string,mixed> $incoming @return array<string,mixed> */
	private function merge_snapshot_values( array $base, array $incoming ): array {
		foreach ( $incoming as $key => $value ) {
			if ( null === $value || '' === $value || ( is_array( $value ) && empty( $value ) ) ) {
				continue;
			}
			if ( is_array( $value ) && ! $this->is_list_array( $value ) && is_array( $base[ $key ] ?? null ) && ! $this->is_list_array( $base[ $key ] ) ) {
				$base[ $key ] = $this->merge_snapshot_values( $base[ $key ], $value );
			} else {
				$base[ $key ] = $value;
			}
		}
		return $base;
	}

	private function is_list_array( array $value ): bool {
		$index = 0;
		foreach ( $value as $key => $_item ) {
			if ( $key !== $index++ ) {
				return false;
			}
		}
		return true;
	}

	/** @param mixed $old @param mixed $new @return array<int,array{lat:float,lng:float}> */
	private function merge_route_points( mixed $old, mixed $new ): array {
		$old_points = $this->normalise_route( $old );
		$new_points = $this->normalise_route( $new );
		$old_keys   = array_map( static fn( array $point ): string => (string) $point['lat'] . '|' . (string) $point['lng'], $old_points );
		$new_keys   = array_map( static fn( array $point ): string => (string) $point['lat'] . '|' . (string) $point['lng'], $new_points );
		$overlap    = 0;
		for ( $length = min( count( $old_keys ), count( $new_keys ) ); $length > 0; $length-- ) {
			if ( array_slice( $old_keys, -$length ) === array_slice( $new_keys, 0, $length ) ) {
				$overlap = $length;
				break;
			}
		}
		$points = array_merge( $old_points, array_slice( $new_points, $overlap ) );
		$deduplicated = array();
		$last_key     = '';
		foreach ( $points as $point ) {
			$key = (string) $point['lat'] . '|' . (string) $point['lng'];
			if ( $key !== $last_key ) {
				$deduplicated[] = $point;
				$last_key       = $key;
			}
		}
		return array_slice( $deduplicated, -200 );
	}

	/** @return array<int,mixed> */
	private function merge_telemetry_samples( mixed $old, mixed $new ): array {
		$old_samples = $this->normalise_telemetry( $old );
		$new_samples = $this->normalise_telemetry( $new );
		$old_keys    = array_map( static fn( mixed $sample ): string => (string) wp_json_encode( $sample ), $old_samples );
		$new_keys    = array_map( static fn( mixed $sample ): string => (string) wp_json_encode( $sample ), $new_samples );
		$overlap     = 0;
		for ( $length = min( count( $old_keys ), count( $new_keys ) ); $length > 0; $length-- ) {
			if ( array_slice( $old_keys, -$length ) === array_slice( $new_keys, 0, $length ) ) {
				$overlap = $length;
				break;
			}
		}
		return array_slice( array_merge( $old_samples, array_slice( $new_samples, $overlap ) ), -120 );
	}

	/** @param array<string,mixed> $input */
	private function input_has_location( array $input ): bool {
		return $this->has_any_key(
			$input,
			array( 'location', 'position', 'lat', 'latitude', 'lng', 'longitude', 'address', 'accuracy', 'accuracy_m', 'altitude', 'altitude_m', 'heading', 'movement', 'location_timestamp', 'position_at', 'gps_timestamp', 'recorded_at', 'recordedAt', 'location_source' )
		);
	}

	/** @param array<string,mixed> $input */
	private function input_has_impact( array $input ): bool {
		return $this->has_any_key(
			$input,
			array( 'impact', 'incident', 'occurred_at', 'detected_at', 'queued_at', 'speed', 'speed_mph', 'previous_speed_mph', 'prior_speed_mph', 'speed_before_mph', 'top_speed_mph', 'peak_g_force', 'resultant_g', 'acceleration', 'axes', 'axis_x', 'axis_y', 'axis_z', 'gravity', 'gravity_x', 'gravity_y', 'gravity_z', 'gravity_magnitude', 'lean', 'lean_degrees', 'max_lean_left', 'max_lean_right', 'impact_source', 'source', 'estimated_orientation', 'orientation', 'movement' )
		);
	}

	/** @param array<string,mixed> $input */
	private function has_any_key( array $input, array $keys ): bool {
		foreach ( $keys as $key ) {
			if ( array_key_exists( $key, $input ) ) {
				return true;
			}
		}
		return false;
	}

	/** @param array<string,mixed> $input */
	private function input_occurrence( array $input ): mixed {
		$impact = is_array( $input['impact'] ?? null ) ? $input['impact'] : ( is_array( $input['incident'] ?? null ) ? $input['incident'] : array() );
		foreach ( array( $input['occurred_at'] ?? null, $input['detected_at'] ?? null, $input['queued_at'] ?? null, $impact['occurred_at'] ?? null, $impact['detected_at'] ?? null, $impact['timestamp'] ?? null ) as $value ) {
			if ( null !== $value && '' !== trim( (string) $value ) ) {
				return $value;
			}
		}
		return null;
	}

	/** @return array<string,mixed> */
	private function severity_tier( ?float $peak_g_force, ?float $impact_speed, ?float $prior_speed ): array {
		$reference_speed = max( 0.0, (float) ( $impact_speed ?? 0.0 ), (float) ( $prior_speed ?? 0.0 ) );
		$reference_g     = max( 0.0, (float) ( $peak_g_force ?? 0.0 ) );
		$tier            = 'unclassified';
		if ( $reference_g >= 8.0 || $reference_speed >= 45.0 ) {
			$tier = 'critical_signal';
		} elseif ( $reference_g >= 5.0 || $reference_speed >= 30.0 ) {
			$tier = 'high_signal';
		} elseif ( $reference_g >= 3.0 || $reference_speed >= 15.0 ) {
			$tier = 'elevated_signal';
		} elseif ( null !== $peak_g_force || null !== $impact_speed || null !== $prior_speed ) {
			$tier = 'lower_signal';
		}
		return array(
			'tier'                  => $tier,
			'peak_g_force'          => $peak_g_force,
			'reference_speed_mph'   => round( $reference_speed, 2 ),
			'thresholds'            => array( 'elevated' => '3g or 15mph', 'high' => '5g or 30mph', 'critical' => '8g or 45mph' ),
			'method'                => 'Highest telemetry threshold crossed; this is response triage, not an injury assessment.',
			'not_injury_assessment' => true,
		);
	}

	/** Optional, asynchronous address enrichment. */
	public function enrich_incident_address( mixed $incident_id ): void {
		global $wpdb;

		$incident = $this->incident_by_id( absint( $incident_id ) );
		if ( ! $incident || ( 'accepted' !== (string) $incident->primary_status && 'accepted' !== (string) $incident->backup_status ) ) {
			return;
		}
		$snapshot = $this->snapshot_for_incident( $incident );
		$location = is_array( $snapshot['location'] ?? null ) ? $snapshot['location'] : array();
		$lat      = $this->coordinate( $location['lat'] ?? null, -90, 90 );
		$lng      = $this->coordinate( $location['lng'] ?? null, -180, 180 );
		if ( null === $lat || null === $lng || '' !== trim( (string) ( $location['address'] ?? '' ) ) ) {
			return;
		}

		try {
			$address = apply_filters( 'avenra_halo_v2_emergency_reverse_geocode', null, $lat, $lng, (int) $incident->id );
		} catch ( Throwable $error ) {
			return;
		}
		try {
			$use_nominatim = ! is_string( $address ) && ( 'accepted' === (string) $incident->primary_status || 'accepted' === (string) $incident->backup_status ) && (bool) apply_filters( 'avenra_halo_v2_emergency_enable_nominatim', false, $incident );
		} catch ( Throwable $error ) {
			$use_nominatim = false;
		}
		if ( $use_nominatim ) {
			$url = add_query_arg(
				array( 'format' => 'jsonv2', 'lat' => $lat, 'lon' => $lng, 'addressdetails' => 1, 'zoom' => 18 ),
				'https://nominatim.openstreetmap.org/reverse'
			);
			try {
				$response = wp_remote_get(
					$url,
					array(
						'timeout'     => 4,
						'redirection' => 0,
						'sslverify'   => true,
						'user-agent'  => 'Avenra-Halo/' . AVENRA_HALO_V2_VERSION . ' (info@rideavenra.com)',
					)
				);
			} catch ( Throwable $error ) {
				$response = new WP_Error( 'reverse_geocode_unavailable' );
			}
			if ( ! is_wp_error( $response ) && 200 === (int) wp_remote_retrieve_response_code( $response ) ) {
				$decoded = json_decode( (string) wp_remote_retrieve_body( $response ), true );
				$address = is_array( $decoded ) ? (string) ( $decoded['display_name'] ?? '' ) : '';
			}
		}
		$address = is_string( $address ) ? $this->text( sanitize_text_field( $address ), 300 ) : '';
		if ( '' === $address ) {
			return;
		}
		// Reverse geocoding happens outside the privacy locks, but the eventual
		// snapshot write must use the same consent ordering as live telemetry.
		// Otherwise an address-enrichment worker could wait on a consent-change
		// transaction and then restore the pre-withdrawal encrypted snapshot.
		$consent_locks = $this->acquire_snapshot_consent_locks( (int) $incident->customer_id );
		if ( is_wp_error( $consent_locks ) ) {
			return;
		}
		try {
			$lock = $this->db->acquire_advisory_lock( 'emergency-incident-id', (string) $incident->id, 2 );
			if ( ! $lock ) {
				return;
			}
			try {
				$current = $this->incident_by_id( (int) $incident->id );
				if ( ! $current || ( 'accepted' !== (string) $current->primary_status && 'accepted' !== (string) $current->backup_status ) ) {
					return;
				}
				$latest          = $this->redact_snapshot_for_current_consent( $this->snapshot_for_incident( $current ), (int) $current->customer_id );
				$latest_location = is_array( $latest['location'] ?? null ) ? $latest['location'] : array();
				$latest_lat      = $this->coordinate( $latest_location['lat'] ?? null, -90, 90 );
				$latest_lng      = $this->coordinate( $latest_location['lng'] ?? null, -180, 180 );
				if ( null === $latest_lat || null === $latest_lng || abs( $latest_lat - $lat ) > 0.000001 || abs( $latest_lng - $lng ) > 0.000001 || '' !== trim( (string) ( $latest_location['address'] ?? '' ) ) ) {
					return;
				}
				$latest['location']['address'] = $address;
				$impact_location = is_array( $latest['impact_location'] ?? null ) ? $latest['impact_location'] : array();
				$impact_lat = $this->coordinate( $impact_location['lat'] ?? null, -90, 90 );
				$impact_lng = $this->coordinate( $impact_location['lng'] ?? null, -180, 180 );
				if ( null !== $impact_lat && null !== $impact_lng && abs( $impact_lat - $lat ) <= 0.000001 && abs( $impact_lng - $lng ) <= 0.000001 && '' === trim( (string) ( $impact_location['address'] ?? '' ) ) ) {
					$latest['impact_location']['address'] = $address;
				}
				$ciphertext = $this->encrypt_value( $latest, $this->snapshot_aad( (int) $current->customer_id, (string) $current->client_event_id ) );
				if ( ! is_wp_error( $ciphertext ) ) {
					$wpdb->update( $this->db->table( 'incidents' ), array( 'snapshot_ciphertext' => $ciphertext, 'updated_at' => current_time( 'mysql', true ) ), array( 'id' => (int) $current->id ) );
				}
			} finally {
				$this->db->release_advisory_lock( $lock );
			}
		} finally {
			$this->release_snapshot_consent_locks( $consent_locks );
		}
	}

	/** Redact rich data after retention while retaining the audit timeline. */
	public function cleanup(): void {
		global $wpdb;

		if ( ! $this->storage_ready() ) {
			return;
		}
		$now       = current_time( 'mysql', true );
		try {
			$retention = (int) apply_filters( 'avenra_halo_v2_emergency_snapshot_retention_days', 90 );
		} catch ( Throwable $error ) {
			$retention = 90;
		}
		$retention = min( 3650, max( 30, $retention ) );
		$cutoff    = gmdate( 'Y-m-d H:i:s', time() - $retention * DAY_IN_SECONDS );
		$table     = esc_sql( $this->db->table( 'incidents' ) );
		$wpdb->query( $wpdb->prepare( "UPDATE `{$table}` SET primary_token_hash = NULL, primary_session_hash = NULL, updated_at = %s WHERE primary_expires_at IS NOT NULL AND primary_expires_at < %s AND (primary_token_hash IS NOT NULL OR primary_session_hash IS NOT NULL)", $now, $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( $wpdb->prepare( "UPDATE `{$table}` SET backup_token_hash = NULL, backup_session_hash = NULL, updated_at = %s WHERE backup_expires_at IS NOT NULL AND backup_expires_at < %s AND (backup_token_hash IS NOT NULL OR backup_session_hash IS NOT NULL)", $now, $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query( $wpdb->prepare( "UPDATE `{$table}` SET snapshot_ciphertext = NULL, acknowledger_ciphertext = NULL, snapshot_redacted_at = %s, updated_at = %s WHERE snapshot_ciphertext IS NOT NULL AND created_at < %s", $now, $now, $cutoff ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/** @return string|WP_Error */
	private function encrypt_value( array $value, string $aad ): string|WP_Error {
		$key = $this->encryption_key();
		if ( is_wp_error( $key ) ) {
			return $key;
		}
		$json = wp_json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		if ( ! is_string( $json ) ) {
			return new WP_Error( 'emergency_encryption_failed', __( 'Emergency Assist could not protect the incident snapshot.', 'avenra-halo-v2' ) );
		}
		try {
			if ( function_exists( 'sodium_crypto_aead_xchacha20poly1305_ietf_encrypt' ) ) {
				$nonce  = random_bytes( SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES );
				$cipher = sodium_crypto_aead_xchacha20poly1305_ietf_encrypt( $json, $aad, $nonce, $key );
				$encoded = wp_json_encode( array( 'v' => 1, 'alg' => 'xchacha20-poly1305', 'nonce' => base64_encode( $nonce ), 'ciphertext' => base64_encode( $cipher ) ) );
				if ( is_string( $encoded ) && '' !== $encoded ) {
					return $encoded;
				}
			}
			if ( function_exists( 'openssl_encrypt' ) && function_exists( 'openssl_get_cipher_methods' ) && in_array( 'aes-256-gcm', openssl_get_cipher_methods(), true ) ) {
				$iv     = random_bytes( 12 );
				$tag    = '';
				$cipher = openssl_encrypt( $json, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, $aad, 16 );
				if ( false !== $cipher && 16 === strlen( $tag ) ) {
					$encoded = wp_json_encode( array( 'v' => 1, 'alg' => 'aes-256-gcm', 'nonce' => base64_encode( $iv ), 'tag' => base64_encode( $tag ), 'ciphertext' => base64_encode( $cipher ) ) );
					if ( is_string( $encoded ) && '' !== $encoded ) {
						return $encoded;
					}
				}
			}
		} catch ( Throwable $error ) {
			// Fail closed below. Incident data is never stored as plaintext.
		}
		return new WP_Error( 'emergency_encryption_unavailable', __( 'Emergency Assist encryption is unavailable.', 'avenra-halo-v2' ) );
	}

	/** @return array<string,mixed>|null */
	private function decrypt_value( string $envelope, string $aad ): ?array {
		$key = $this->encryption_key();
		if ( is_wp_error( $key ) ) {
			return null;
		}
		$data = json_decode( $envelope, true );
		if ( ! is_array( $data ) || 1 !== (int) ( $data['v'] ?? 0 ) ) {
			return null;
		}
		$nonce  = base64_decode( (string) ( $data['nonce'] ?? '' ), true );
		$cipher = base64_decode( (string) ( $data['ciphertext'] ?? '' ), true );
		if ( false === $nonce || false === $cipher ) {
			return null;
		}
		try {
			$plain = false;
			if ( 'xchacha20-poly1305' === ( $data['alg'] ?? '' ) && function_exists( 'sodium_crypto_aead_xchacha20poly1305_ietf_decrypt' ) ) {
				$plain = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt( $cipher, $aad, $nonce, $key );
			} elseif ( 'aes-256-gcm' === ( $data['alg'] ?? '' ) && function_exists( 'openssl_decrypt' ) ) {
				$tag = base64_decode( (string) ( $data['tag'] ?? '' ), true );
				if ( false !== $tag ) {
					$plain = openssl_decrypt( $cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag, $aad );
				}
			}
			$decoded = is_string( $plain ) ? json_decode( $plain, true ) : null;
			return is_array( $decoded ) ? $decoded : null;
		} catch ( Throwable $error ) {
			return null;
		}
	}

	/** @return string|WP_Error Stable, filterable key material derived from WP salts. */
	private function encryption_key(): string|WP_Error {
		$derived = hash_hmac( 'sha256', 'avenra-halo-v2-emergency-encryption-v1', wp_salt( 'secure_auth' ) . '|' . wp_salt( 'auth' ), true );
		try {
			$filtered = apply_filters( 'avenra_halo_v2_emergency_encryption_key', $derived );
		} catch ( Throwable $error ) {
			return new WP_Error( 'emergency_encryption_unavailable', __( 'Emergency Assist encryption is unavailable.', 'avenra-halo-v2' ) );
		}
		if ( ! is_string( $filtered ) || strlen( $filtered ) < 32 ) {
			return new WP_Error( 'emergency_encryption_unavailable', __( 'Emergency Assist encryption is unavailable.', 'avenra-halo-v2' ) );
		}
		return hash( 'sha256', $filtered, true );
	}

	private function storage_ready(): bool {
		return $this->db->table_exists( $this->db->table( 'emergency_settings' ) )
			&& $this->db->table_exists( $this->db->table( 'consent_events' ) )
			&& $this->db->table_exists( $this->db->table( 'incidents' ) )
			&& $this->db->table_exists( $this->db->table( 'incident_events' ) );
	}

	private function incident_by_id( int $incident_id ): ?object {
		global $wpdb;
		if ( $incident_id < 1 || ! $this->db->table_exists( $this->db->table( 'incidents' ) ) ) {
			return null;
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$incident_id
			)
		);
		return is_object( $row ) ? $row : null;
	}

	private function incident_by_event( int $customer_id, string $event_id ): ?object {
		global $wpdb;
		if ( $customer_id < 1 || '' === $event_id || ! $this->db->table_exists( $this->db->table( 'incidents' ) ) ) {
			return null;
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE customer_id = %d AND client_event_id = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id,
				$event_id
			)
		);
		return is_object( $row ) ? $row : null;
	}

	private function incident_by_public_id( string $public_id ): ?object {
		global $wpdb;
		if ( ! preg_match( '/^[a-f0-9-]{36}$/i', $public_id ) || ! $this->db->table_exists( $this->db->table( 'incidents' ) ) ) {
			return null;
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE public_id = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$public_id
			)
		);
		return is_object( $row ) ? $row : null;
	}

	/** @return array<string,mixed> */
	private function incident_response( object $incident ): array {
		$accepted = 'accepted' === (string) $incident->primary_status || 'accepted' === (string) $incident->backup_status;
		$is_test  = $this->is_test_incident( $incident );
		$activation_due_at = '' !== (string) ( $incident->activation_due_at ?? '' ) ? strtotime( (string) $incident->activation_due_at . ' UTC' ) : false;
		$activation_due_seconds = 'candidate' === (string) $incident->status && false !== $activation_due_at
			? max( 0, $activation_due_at - time() )
			: null;
		$due_at   = '' !== (string) ( $incident->escalation_due_at ?? '' ) ? strtotime( (string) $incident->escalation_due_at . ' UTC' ) : false;
		$backup_due_seconds = null;
		if ( 'pending' === (string) $incident->backup_status && null === $incident->first_acknowledged_at && false !== $due_at ) {
			$backup_due_seconds = max( 0, $due_at - time() );
		}
		$acknowledged = null !== $incident->first_acknowledged_at;
		if ( $is_test && $acknowledged ) {
			$message = __( 'The controlled test exercise has been acknowledged. No real-world emergency action is available.', 'avenra-halo-v2' );
		} elseif ( $is_test && $accepted ) {
			$message = __( 'The test notification was accepted by its configured test provider. Handset receipt still requires acknowledgement.', 'avenra-halo-v2' );
		} elseif ( $is_test && 'candidate' === (string) $incident->status ) {
			$message = __( 'The controlled test candidate is protected and no notification has been dispatched.', 'avenra-halo-v2' );
		} elseif ( $is_test ) {
			$message = __( 'The test notification was not confirmed. No emergency services or next of kin have been contacted.', 'avenra-halo-v2' );
		} elseif ( 'cancelled' === (string) $incident->status ) {
			$message = __( 'Emergency Assist cancellation is confirmed. No responder was contacted for this incident.', 'avenra-halo-v2' );
		} elseif ( $acknowledged ) {
			$message = __( 'A responder has acknowledged this incident. This confirms dashboard response, not SMS handset delivery.', 'avenra-halo-v2' );
		} elseif ( $accepted ) {
			$message = __( 'A responder SMS was accepted by the provider. Handset delivery is not confirmed until a responder acknowledges.', 'avenra-halo-v2' );
		} elseif ( 'candidate' === (string) $incident->status ) {
			$message = __( 'The Emergency Assist candidate is protected, but no responder message has been sent.', 'avenra-halo-v2' );
		} elseif ( in_array( (string) $incident->primary_status, array( 'failed', 'unconfirmed' ), true ) && in_array( (string) $incident->backup_status, array( 'failed', 'unconfirmed' ), true ) ) {
			$message = __( 'Neither responder SMS was confirmed as accepted. Halo has no hidden retry pending; call 999 now if anyone may be injured.', 'avenra-halo-v2' );
		} else {
			$message = __( 'No responder SMS has yet been accepted by a provider. Halo will continue the configured escalation path.', 'avenra-halo-v2' );
		}
		return array(
			'emergency_assist'   => true,
			'incident_id'        => sanitize_text_field( (string) $incident->public_id ),
			'event_id'           => sanitize_text_field( (string) $incident->client_event_id ),
			'status'             => sanitize_key( (string) $incident->status ),
			'source'             => sanitize_key( (string) $incident->source ),
			'is_test'            => $is_test,
			'test_dispatch_mode' => sanitize_key( (string) ( $incident->test_dispatch_mode ?? '' ) ),
			'test_scenario'      => sanitize_key( (string) ( $incident->test_scenario ?? '' ) ),
			'accepted'           => $accepted,
			'provider_accepted'   => $accepted,
			'delivery_semantic'  => $accepted ? 'provider_accepted' : 'not_provider_accepted',
			'delivery_confirmed' => false,
			'responder_acknowledged' => $acknowledged,
			'message'            => $message,
			'primary_status'     => sanitize_key( (string) $incident->primary_status ),
			'backup_status'      => sanitize_key( (string) $incident->backup_status ),
			'activation_due_at'  => $this->rfc3339( $incident->activation_due_at ?? null ),
			'activation_due_seconds' => $activation_due_seconds,
			'backup_due_seconds' => $backup_due_seconds,
			'acknowledged'       => $acknowledged,
			'activated_at'       => $this->rfc3339( $incident->activated_at ?? null ),
			'acknowledged_at'    => $this->rfc3339( $incident->first_acknowledged_at ?? null ),
			'resolved_at'        => $this->rfc3339( $incident->resolved_at ?? null ),
		);
	}

	private function is_test_incident( object $incident ): bool {
		return '1' === (string) ( $incident->is_test ?? '0' ) || in_array( (string) ( $incident->source ?? '' ), array( 'test', 'simulation' ), true );
	}

	private function dispatch_provider_label( object $incident ): string {
		return 'simulation' === (string) ( $incident->source ?? '' ) ? 'simulation' : 'firetext';
	}

	private function destination( string $role ): string {
		try {
			if ( 'backup' === $role ) {
				$value = defined( 'AVENRA_HALO_EMERGENCY_BACKUP_MOBILE' ) ? (string) AVENRA_HALO_EMERGENCY_BACKUP_MOBILE : self::DEFAULT_BACKUP;
				$value = (string) apply_filters( 'avenra_halo_v2_emergency_backup_mobile', $value );
			} else {
				$value = defined( 'AVENRA_HALO_EMERGENCY_PRIMARY_MOBILE' ) ? (string) AVENRA_HALO_EMERGENCY_PRIMARY_MOBILE : self::DEFAULT_PRIMARY;
				$value = (string) apply_filters( 'avenra_halo_v2_emergency_primary_mobile', $value );
			}
		} catch ( Throwable $error ) {
			return '';
		}
		return $this->normalise_mobile( $value );
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

	private function token_lifetime(): int {
		try {
			$hours = (int) apply_filters( 'avenra_halo_v2_emergency_token_lifetime_hours', 72 );
		} catch ( Throwable $error ) {
			$hours = 72;
		}
		$hours = min( 168, max( 1, $hours ) );
		return $hours * HOUR_IN_SECONDS;
	}

	private function cancellation_delay(): int {
		try {
			$seconds = (int) apply_filters( 'avenra_halo_v2_emergency_cancellation_delay_seconds', 20 );
		} catch ( Throwable $error ) {
			$seconds = 20;
		}
		// Keep the server deadline aligned with the visible safety countdown.
		return min( 30, max( 10, $seconds ) );
	}

	private function backup_delay(): int {
		try {
			$seconds = (int) apply_filters( 'avenra_halo_v2_emergency_backup_delay_seconds', 15 );
		} catch ( Throwable $error ) {
			$seconds = 15;
		}
		return min( 120, max( 5, $seconds ) );
	}

	private function random_token(): string {
		try {
			return rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
		} catch ( Throwable $error ) {
			return '';
		}
	}

	private function token_hash( string $token ): string {
		return hash_hmac( 'sha256', $token, wp_salt( 'auth' ) );
	}

	private function snapshot_aad( int $customer_id, string $event_id ): string {
		return 'incident|v1|' . $customer_id . '|' . $event_id;
	}

	private function responder_csrf( string $session_token ): string {
		return hash_hmac( 'sha256', 'responder-action|' . $session_token, wp_salt( 'nonce' ) );
	}

	private function responder_cookie_name( object $incident, string $role ): string {
		$public_id = strtolower( sanitize_text_field( (string) ( $incident->public_id ?? '' ) ) );
		$role      = 'backup' === $role ? 'backup' : 'primary';
		$scope     = substr( hash_hmac( 'sha256', $public_id . '|' . $role, wp_salt( 'auth' ) ), 0, 24 );
		return self::COOKIE . '_' . $role . '_' . $scope;
	}

	/**
	 * Read this incident-and-role cookie, with a narrowly matched legacy fallback.
	 * The caller must still compare the returned token hash with the selected
	 * incident's role-specific session hash.
	 */
	private function responder_cookie_token( object $incident, string $role, bool $allow_legacy = false ): string {
		$cookie_name = $this->responder_cookie_name( $incident, $role );
		$candidates  = array();
		if ( isset( $_COOKIE[ $cookie_name ] ) ) {
			$candidates[] = (string) wp_unslash( $_COOKIE[ $cookie_name ] );
		}
		if ( $allow_legacy && isset( $_COOKIE[ self::COOKIE ] ) ) {
			$candidates[] = (string) wp_unslash( $_COOKIE[ self::COOKIE ] );
		}
		$session_column = ( 'backup' === $role ? 'backup' : 'primary' ) . '_session_hash';
		$expected_hash  = (string) ( $incident->{$session_column} ?? '' );
		foreach ( $candidates as $candidate ) {
			$token = trim( sanitize_text_field( $candidate ) );
			if ( preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $token ) && '' !== $expected_hash && hash_equals( $expected_hash, $this->token_hash( $token ) ) ) {
				return $token;
			}
		}
		return '';
	}

	private function responder_dashboard_url( object $incident, string $role ): string {
		return add_query_arg(
			array(
				'incident' => sanitize_text_field( (string) ( $incident->public_id ?? '' ) ),
				'role'     => 'backup' === $role ? 'backup' : 'primary',
			),
			trailingslashit( home_url( '/halo-assist/' ) )
		);
	}

	private function set_responder_cookie( string $token, string $expires_at, object $incident, string $role ): bool {
		if ( headers_sent() ) {
			return false;
		}
		$expires = strtotime( $expires_at . ' UTC' );
		if ( false === $expires || $expires <= time() ) {
			return false;
		}
		return setcookie(
			$this->responder_cookie_name( $incident, $role ),
			$token,
			array(
				'expires'  => $expires,
				'path'     => '/',
				'secure'   => true,
				'httponly' => true,
				'samesite' => 'Strict',
			)
		);
	}

	private function clear_responder_cookie( string $cookie_name = self::COOKIE ): void {
		if ( ! headers_sent() ) {
			setcookie( $cookie_name, '', array( 'expires' => time() - HOUR_IN_SECONDS, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict' ) );
		}
	}

	private function clear_requested_responder_cookie(): void {
		$public_id = isset( $_GET['incident'] ) && is_scalar( $_GET['incident'] ) ? sanitize_text_field( (string) wp_unslash( $_GET['incident'] ) ) : '';
		$role      = isset( $_GET['role'] ) && is_scalar( $_GET['role'] ) ? sanitize_key( (string) wp_unslash( $_GET['role'] ) ) : '';
		if ( preg_match( '/^[a-fA-F0-9-]{36}$/', $public_id ) && in_array( $role, array( 'primary', 'backup' ), true ) ) {
			$incident = $this->incident_by_public_id( $public_id );
			if ( $incident ) {
				$this->clear_responder_cookie( $this->responder_cookie_name( $incident, $role ) );
				return;
			}
		}
		$this->clear_responder_cookie();
	}

	private function same_origin_request(): bool {
		$fetch_site = strtolower( trim( (string) ( $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '' ) ) );
		if ( 'cross-site' === $fetch_site ) {
			return false;
		}
		$source = trim( (string) ( $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '' ) );
		if ( '' === $source ) {
			return in_array( $fetch_site, array( '', 'none', 'same-origin' ), true );
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

	private function store_notice( string $session_token, string $message, string $type ): void {
		set_transient(
			'avh2_em_notice_' . substr( $this->token_hash( $session_token ), 0, 40 ),
			array( 'message' => sanitize_text_field( $message ), 'type' => 'success' === $type ? 'success' : 'error' ),
			MINUTE_IN_SECONDS
		);
	}

	/** @param array{incident:object,role:string,session_token:string,expires_at:string} $session */
	private function redirect_dashboard( array $session ): void {
		wp_safe_redirect( $this->responder_dashboard_url( $session['incident'], $session['role'] ), 303 );
		exit;
	}

	/** @param array<string,mixed> $data */
	private function json_response( bool $success, string $code, int $status, array $data = array() ): void {
		$this->security_headers( false );
		status_header( $status );
		header( 'Content-Type: application/json; charset=' . get_bloginfo( 'charset' ), true );
		echo wp_json_encode( array_merge( array( 'success' => $success, 'code' => sanitize_key( $code ) ), $data ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		exit;
	}

	private function provider_id( mixed $value ): string {
		if ( is_array( $value ) ) {
			$value = reset( $value );
		}
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		$value = sanitize_text_field( (string) $value );
		return preg_match( '/^[A-Za-z0-9._:-]{1,100}$/', $value ) ? $value : '';
	}

	private function object_value( object $object, array $keys ): string {
		foreach ( $keys as $key ) {
			if ( isset( $object->{$key} ) && '' !== trim( (string) $object->{$key} ) ) {
				return $this->text( sanitize_text_field( (string) $object->{$key} ), 255 );
			}
		}
		return '';
	}

	private function text( string $value, int $length ): string {
		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, $length ) : substr( $value, 0, $length );
	}

	private function truthy( mixed $value ): bool {
		return true === $value || 1 === $value || '1' === $value || in_array( strtolower( trim( (string) $value ) ), array( 'true', 'yes', 'on' ), true );
	}

	private function number_or_null( mixed $value ): ?float {
		return is_numeric( $value ) && is_finite( (float) $value ) ? round( (float) $value, 7 ) : null;
	}

	private function coordinate( mixed $value, float $minimum, float $maximum ): ?float {
		$number = $this->number_or_null( $value );
		return null !== $number && $number >= $minimum && $number <= $maximum ? $number : null;
	}

	private function mysql_time( mixed $value ): string {
		if ( is_numeric( $value ) ) {
			$number = (float) $value;
			$time   = (int) ( $number > 100000000000 ? $number / 1000 : $number );
		} else {
			$parsed = '' !== trim( (string) $value ) ? strtotime( (string) $value ) : false;
			$time   = false === $parsed ? time() : $parsed;
		}
		return gmdate( 'Y-m-d H:i:s', $time > 0 ? $time : time() );
	}

	private function rfc3339( mixed $value ): ?string {
		if ( null === $value || '' === trim( (string) $value ) || '0000-00-00 00:00:00' === (string) $value ) {
			return null;
		}
		$time = strtotime( (string) $value . ( preg_match( '/(?:Z|[+-]\d\d:?\d\d)$/', (string) $value ) ? '' : ' UTC' ) );
		return false === $time ? null : gmdate( DATE_RFC3339, $time );
	}

	/** @return array<int,array{lat:float,lng:float}> */
	private function normalise_route( mixed $route ): array {
		if ( is_string( $route ) ) {
			$decoded = json_decode( $route, true );
			$route   = is_array( $decoded ) ? $decoded : array();
		}
		if ( ! is_array( $route ) ) {
			return array();
		}
		$points = array();
		foreach ( array_slice( $route, -200 ) as $point ) {
			if ( ! is_array( $point ) ) {
				continue;
			}
			$indexed = array_key_exists( 0, $point ) && array_key_exists( 1, $point );
			$lat = $this->coordinate( $point['lat'] ?? $point['latitude'] ?? ( $indexed ? $point[1] : null ), -90, 90 );
			$lng = $this->coordinate( $point['lng'] ?? $point['longitude'] ?? ( $indexed ? $point[0] : null ), -180, 180 );
			if ( null !== $lat && null !== $lng ) {
				$points[] = array( 'lat' => $lat, 'lng' => $lng );
			}
		}
		return $points;
	}

	/** @return array<string,mixed> */
	private function normalise_planned_route( mixed $route ): array {
		if ( is_string( $route ) ) {
			$decoded = json_decode( $route, true );
			$route   = is_array( $decoded ) ? $decoded : array();
		}
		if ( ! is_array( $route ) ) {
			return array();
		}
		$points = $this->normalise_route( $route['points'] ?? array() );
		$points = array_slice( $points, 0, 12 );
		return array(
			'id'                => $this->text( sanitize_text_field( (string) ( $route['id'] ?? $route['route_id'] ?? '' ) ), 80 ),
			'title'             => $this->text( sanitize_text_field( (string) ( $route['title'] ?? $route['name'] ?? '' ) ), 160 ),
			'start_label'       => $this->text( sanitize_text_field( (string) ( $route['startLabel'] ?? $route['start_label'] ?? $route['origin_label'] ?? '' ) ), 180 ),
			'destination_label' => $this->text( sanitize_text_field( (string) ( $route['destinationLabel'] ?? $route['destination_label'] ?? $route['end_label'] ?? '' ) ), 180 ),
			'distance_miles'    => $this->number_or_null( $route['distanceMiles'] ?? $route['distance_miles'] ?? $route['distance'] ?? null ),
			'duration_seconds'  => max( 0, min( 604800, (int) ( $route['durationSeconds'] ?? $route['duration_seconds'] ?? $route['duration_s'] ?? 0 ) ) ),
			'profile'           => $this->text( sanitize_key( (string) ( $route['profile'] ?? $route['route_profile'] ?? '' ) ), 40 ),
			'point_count'       => max( 0, min( 100000, (int) ( $route['pointCount'] ?? $route['point_count'] ?? count( $points ) ) ) ),
			'points'            => $points,
		);
	}

	/** @return array<int,mixed> */
	private function normalise_telemetry( mixed $telemetry ): array {
		if ( is_string( $telemetry ) ) {
			$decoded   = json_decode( $telemetry, true );
			$telemetry = is_array( $decoded ) ? $decoded : array();
		}
		return is_array( $telemetry ) ? array_values( array_slice( $this->normalise_value( $telemetry, 0 ), -120 ) ) : array();
	}

	private function normalise_value( mixed $value, int $depth ): mixed {
		if ( $depth > 5 ) {
			return null;
		}
		if ( is_array( $value ) ) {
			$output = array();
			foreach ( array_slice( $value, 0, 250, true ) as $key => $item ) {
				$key = is_int( $key ) ? $key : $this->text( sanitize_key( (string) $key ), 64 );
				$output[ $key ] = $this->normalise_value( $item, $depth + 1 );
			}
			return $output;
		}
		if ( is_bool( $value ) || is_int( $value ) || is_float( $value ) || null === $value ) {
			return $value;
		}
		return $this->text( sanitize_text_field( (string) $value ), 2000 );
	}

	/** @return array<string,mixed> */
	private function safe_event_metadata( array $metadata ): array {
		$safe = array();
		foreach ( array_slice( $metadata, 0, 20, true ) as $key => $value ) {
			$key = sanitize_key( (string) $key );
			if ( '' === $key || in_array( $key, array( 'token', 'message', 'destination', 'mobile', 'phone', 'name', 'medical', 'snapshot', 'payload', 'response' ), true ) ) {
				continue;
			}
			if ( is_bool( $value ) || is_int( $value ) || is_float( $value ) || null === $value ) {
				$safe[ $key ] = $value;
			} elseif ( is_scalar( $value ) ) {
				$safe[ $key ] = $this->text( sanitize_text_field( (string) $value ), 120 );
			}
		}
		return $safe;
	}

	/** @return array<int,array{lat:float,lng:float}> */
	private function route_points( array $snapshot ): array {
		return $this->normalise_route( $snapshot['recent_route'] ?? array() );
	}

	private function osm_url( array $snapshot ): string {
		$location = is_array( $snapshot['location'] ?? null ) ? $snapshot['location'] : array();
		$lat      = $this->coordinate( $location['lat'] ?? null, -90, 90 );
		$lng      = $this->coordinate( $location['lng'] ?? null, -180, 180 );
		if ( null === $lat || null === $lng ) {
			return '';
		}
		return 'https://www.openstreetmap.org/?mlat=' . rawurlencode( (string) $lat ) . '&mlon=' . rawurlencode( (string) $lng ) . '#map=18/' . rawurlencode( (string) $lat ) . '/' . rawurlencode( (string) $lng );
	}
}
