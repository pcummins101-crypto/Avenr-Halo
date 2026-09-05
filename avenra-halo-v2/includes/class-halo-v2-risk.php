<?php

defined( 'ABSPATH' ) || exit;

/**
 * Versioned, explainable ride-risk indicator for the staff operations console.
 *
 * This is deliberately a behavioural summary of recorded phone telemetry. It
 * is not an accident prediction, an insurance rating, or a declaration that a
 * rider is safe. No demographic, medical, address or postcode data is used.
 */
final class Avenra_Halo_V2_Risk {
	private const MODEL_VERSION = '1.0';
	private const WINDOW_DAYS = 90;
	private const MAX_RIDES = 20;
	private const STALE_SECONDS = 86400;
	private const REFRESH_BATCH = 10;

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
		add_action( 'avenra_halo_v2_ride_saved', array( $this, 'ride_saved' ), 10, 2 );
		add_action( 'avenra_halo_v2_emergency_assist_consent_changed', array( $this, 'assist_consent_changed' ), 10, 2 );
	}

	public function assist_consent_changed( int $customer_id, bool $enabled ): void {
		global $wpdb;

		$customer_id = absint( $customer_id );
		$table = $this->db->table( 'risk_profiles' );
		if ( $customer_id < 1 || ! $this->db->table_exists( $table ) ) {
			return;
		}
		if ( ! $enabled || ! Avenra_Halo_V2_Emergency::instance()->has_assist_consent( $customer_id ) ) {
			$wpdb->delete( $table, array( 'customer_id' => $customer_id ), array( '%d' ) );
			return;
		}
		try {
			$this->recalculate_customer( $customer_id );
		} catch ( Throwable $error ) {
			do_action( 'avenra_halo_v2_risk_recalculation_error', 0, $customer_id, get_class( $error ) );
		}
	}

	public function ride_saved( int $ride_id, int $customer_id ): void {
		if ( $customer_id < 1 ) {
			return;
		}
		try {
			$this->recalculate_customer( $customer_id );
		} catch ( Throwable $error ) {
			// A derived staff indicator must never turn a successfully persisted
			// customer ride into a failed sync response.
			do_action( 'avenra_halo_v2_risk_recalculation_error', $ride_id, $customer_id, get_class( $error ) );
		}
	}

	public function model_version(): string {
		return self::MODEL_VERSION;
	}

	/** @return array<string,mixed> */
	public function profile_for_customer( int $customer_id, bool $refresh_stale = true ): array {
		$customer_id = absint( $customer_id );
		$profiles = $this->profiles_for_customers( array( $customer_id ), $refresh_stale );
		return $profiles[ $customer_id ] ?? $this->empty_profile( $customer_id );
	}

	/**
	 * Fetch profiles for a console page. Missing or stale rows are refreshed in
	 * a bounded batch so an all-customer directory cannot turn one request into
	 * an unbounded telemetry scan.
	 *
	 * @param int[] $customer_ids Customer source-table identifiers.
	 * @return array<int,array<string,mixed>> Profiles keyed by customer ID.
	 */
	public function profiles_for_customers( array $customer_ids, bool $refresh_stale = true ): array {
		global $wpdb;

		$ids = array_values( array_unique( array_filter( array_map( 'absint', $customer_ids ) ) ) );
		$profiles = array();
		foreach ( $ids as $customer_id ) {
			$profiles[ $customer_id ] = $this->empty_profile( $customer_id );
		}
		$table = $this->db->table( 'risk_profiles' );
		$settings_table = $this->db->table( 'emergency_settings' );
		if ( ! $ids || ! $this->db->table_exists( $table ) || ! $this->db->table_exists( $settings_table ) ) {
			return $profiles;
		}

		$consent_placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$consent_args = array_merge( $ids, array( Avenra_Halo_V2_Emergency::instance()->required_consent_version() ) );
		$consented = $wpdb->get_col(
			$wpdb->prepare(
				'SELECT customer_id FROM `' . esc_sql( $settings_table ) . '` WHERE customer_id IN (' . $consent_placeholders . ') AND assist_enabled = 1 AND consent_version = %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$consent_args
			)
		);
		$consented_ids = array_values( array_unique( array_map( 'absint', is_array( $consented ) ? $consented : array() ) ) );
		$unconsented_ids = array_values( array_diff( $ids, $consented_ids ) );
		if ( $unconsented_ids ) {
			$wpdb->query( 'DELETE FROM `' . esc_sql( $table ) . '` WHERE customer_id IN (' . implode( ',', $unconsented_ids ) . ')' ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- absint-only list.
		}
		$ids = $consented_ids;
		if ( ! $ids ) {
			return $profiles;
		}

		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$sql = $wpdb->prepare(
			'SELECT * FROM `' . esc_sql( $table ) . '` WHERE customer_id IN (' . $placeholders . ')', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$ids
		);
		$rows = $wpdb->get_results( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows = is_array( $rows ) ? $rows : array();
		$stale = array_fill_keys( $ids, true );
		foreach ( $rows as $row ) {
			$customer_id = (int) $row->customer_id;
			$profiles[ $customer_id ] = $this->serialise_row( $row );
			$calculated = strtotime( (string) $row->calculated_at . ' UTC' );
			if ( hash_equals( self::MODEL_VERSION, (string) $row->model_version ) && false !== $calculated && time() - $calculated < self::STALE_SECONDS ) {
				unset( $stale[ $customer_id ] );
			}
		}

		if ( $refresh_stale ) {
			foreach ( array_slice( array_keys( $stale ), 0, self::REFRESH_BATCH ) as $customer_id ) {
				$profiles[ $customer_id ] = $this->recalculate_customer( (int) $customer_id );
			}
		}
		return $profiles;
	}

	/** @return array<string,mixed> */
	public function recalculate_customer( int $customer_id ): array {
		global $wpdb;

		$risk_table = $this->db->table( 'risk_profiles' );
		$rides_table = $this->db->table( 'rides' );
		if ( $customer_id < 1 || ! $this->db->table_exists( $risk_table ) || ! $this->db->table_exists( $rides_table ) ) {
			return $this->empty_profile( $customer_id );
		}
		if ( ! Avenra_Halo_V2_Emergency::instance()->has_assist_consent( $customer_id ) ) {
			$wpdb->delete( $risk_table, array( 'customer_id' => $customer_id ), array( '%d' ) );
			return $this->empty_profile( $customer_id );
		}

		$lock = $this->db->acquire_advisory_lock( 'risk-profile', (string) $customer_id, 1 );
		if ( ! $lock ) {
			$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $risk_table ) . '` WHERE customer_id = %d LIMIT 1', $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return $row ? $this->serialise_row( $row ) : $this->empty_profile( $customer_id );
		}

		try {
			$window_start = gmdate( 'Y-m-d H:i:s', time() - self::WINDOW_DAYS * DAY_IN_SECONDS );
			$mode_sql = '';
			if ( $this->db->has_column( $rides_table, 'ride_mode' ) ) {
				$mode_sql = " AND (ride_mode IS NULL OR LOWER(ride_mode) NOT IN ('track','track-mode','track_mode','test','simulation','drill'))";
			}
			$rides = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM `" . esc_sql( $rides_table ) . "` WHERE customer_id = %d AND status = 'complete' AND started_at >= %s{$mode_sql} ORDER BY started_at DESC, id DESC LIMIT %d", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id,
					$window_start,
					self::MAX_RIDES
				)
			);
			if ( ! is_array( $rides ) ) {
				$existing = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $risk_table ) . '` WHERE customer_id = %d LIMIT 1', $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				return $existing ? $this->serialise_row( $existing ) : $this->empty_profile( $customer_id );
			}

			$ride_count = count( $rides );
			$total_miles = 0.0;
			$oldest_started_at = null;
			$speed_samples = array();
			$dynamic_miles = 0.0;
			$dynamic_rides = 0;
			$harsh_events = 0;
			$peak_g = 0.0;
			$lean_rides = 0;
			$high_lean_rides = 0;
			$very_high_lean_rides = 0;
			$quality_counts = array( 'high' => 0, 'medium' => 0, 'gps-only' => 0, 'limited' => 0, 'unavailable' => 0 );

			foreach ( $rides as $ride ) {
				$miles = max( 0.0, (float) ( $ride->distance_miles ?? 0 ) );
				$total_miles += $miles;
				$oldest_started_at = (string) ( $ride->started_at ?? $oldest_started_at );
				$quality = sanitize_key( (string) ( $ride->telemetry_quality ?? '' ) );
				if ( ! isset( $quality_counts[ $quality ] ) ) {
					$quality = 'unavailable';
				}
				$quality_counts[ $quality ] += 1;

				$decoded = json_decode( (string) ( $ride->telemetry_json ?? '' ), true );
				foreach ( $this->speed_observations( $this->telemetry_points( is_array( $decoded ) ? $decoded : array() ) ) as $sample ) {
					$speed_samples[] = $sample;
				}

				if ( in_array( $quality, array( 'high', 'medium' ), true ) && null !== ( $ride->peak_g_force ?? null ) ) {
					$dynamic_rides += 1;
					$dynamic_miles += $miles;
					$harsh_events += max( 0, (int) ( $ride->harsh_event_count ?? 0 ) );
					$peak_g = max( $peak_g, max( 0.0, (float) $ride->peak_g_force ) );
				}

				$lean = max( abs( (float) ( $ride->max_lean_left ?? 0 ) ), abs( (float) ( $ride->max_lean_right ?? 0 ) ) );
				if ( in_array( $quality, array( 'high', 'medium' ), true ) && $lean > 0 ) {
					$lean_rides += 1;
					$high_lean_rides += $lean >= 45 ? 1 : 0;
					$very_high_lean_rides += $lean >= 55 ? 1 : 0;
				}
			}

			$exposure = $this->speed_exposure( $speed_samples );
			$speed_available = $exposure['sample_count'] >= 30 && $exposure['observed_seconds'] >= 30;
			$dynamic_available = $dynamic_rides >= 2 && $dynamic_miles >= 20;
			$lean_available = $lean_rides >= 2;
			$serious_incidents = $this->serious_incident_count( $customer_id, $window_start );
			$incident_available = null !== $serious_incidents;

			$speed_score = min( 100.0, $exposure['pct_at_or_above_60'] * 0.4 + $exposure['pct_at_or_above_70'] * 1.4 + $exposure['pct_at_or_above_90'] * 2.2 );
			$harsh_rate = $dynamic_miles > 0 ? $harsh_events / $dynamic_miles * 100 : 0.0;
			$dynamic_score = min( 100.0, $harsh_rate * 8 );
			$incident_rate = $total_miles > 0 && null !== $serious_incidents ? $serious_incidents / $total_miles * 1000 : 0.0;
			$incident_score = min( 100.0, $incident_rate * 100 );
			$high_lean_pct = $lean_rides > 0 ? $high_lean_rides / $lean_rides * 100 : 0.0;
			$very_high_lean_pct = $lean_rides > 0 ? $very_high_lean_rides / $lean_rides * 100 : 0.0;
			$lean_score = min( 100.0, $high_lean_pct * 0.8 + $very_high_lean_pct * 0.7 );

			$factors = array(
				'speed_exposure' => array(
					'label'             => __( 'Elevated-speed exposure', 'avenra-halo-v2' ),
					'available'         => $speed_available,
					'score'             => $speed_available ? round( $speed_score, 1 ) : null,
					'configured_weight' => 45,
					'effective_weight'  => 0,
					'measurements'      => array(
						'sample_count'       => (int) $exposure['sample_count'],
						'observed_minutes'   => round( $exposure['observed_seconds'] / 60, 1 ),
						'pct_at_or_above_60' => round( $exposure['pct_at_or_above_60'], 1 ),
						'pct_at_or_above_70' => round( $exposure['pct_at_or_above_70'], 1 ),
						'pct_at_or_above_90' => round( $exposure['pct_at_or_above_90'], 1 ),
					),
					'explanation'       => __( 'Uses recorded time in speed bands across eligible road rides, rather than a single GPS maximum.', 'avenra-halo-v2' ),
					'limitation'        => __( 'Halo does not match each sample to the road speed limit, and GPS speed can contain errors.', 'avenra-halo-v2' ),
				),
				'dynamics' => array(
					'label'             => __( 'Harsh dynamics', 'avenra-halo-v2' ),
					'available'         => $dynamic_available,
					'score'             => $dynamic_available ? round( $dynamic_score, 1 ) : null,
					'configured_weight' => 25,
					'effective_weight'  => 0,
					'measurements'      => array(
						'events'              => $harsh_events,
						'events_per_100_miles'=> round( $harsh_rate, 2 ),
						'peak_dynamic_g'      => round( $peak_g, 2 ),
						'covered_miles'       => round( $dynamic_miles, 1 ),
					),
					'explanation'       => __( 'Counts separated phone-estimated high-dynamic events per 100 recorded miles.', 'avenra-halo-v2' ),
					'limitation'        => __( 'Phone mounting, device sampling and road vibration affect this estimate.', 'avenra-halo-v2' ),
				),
				'incidents' => array(
					'label'             => __( 'Confirmed serious incidents', 'avenra-halo-v2' ),
					'available'         => $incident_available,
					'score'             => $incident_available ? round( $incident_score, 1 ) : null,
					'configured_weight' => 20,
					'effective_weight'  => 0,
					'measurements'      => array(
						'confirmed_incidents' => (int) ( $serious_incidents ?? 0 ),
						'incidents_per_1000_miles' => round( $incident_rate, 2 ),
					),
					'explanation'       => __( 'Includes only non-test incidents where the workflow records that emergency services were called.', 'avenra-halo-v2' ),
					'limitation'        => __( 'Small ride windows make incident rates volatile.', 'avenra-halo-v2' ),
				),
				'lean' => array(
					'label'             => __( 'High-lean exposure', 'avenra-halo-v2' ),
					'available'         => $lean_available,
					'score'             => $lean_available ? round( $lean_score, 1 ) : null,
					'configured_weight' => 10,
					'effective_weight'  => 0,
					'measurements'      => array(
						'eligible_rides'       => $lean_rides,
						'pct_at_or_above_45'   => round( $high_lean_pct, 1 ),
						'pct_at_or_above_55'   => round( $very_high_lean_pct, 1 ),
					),
					'explanation'       => __( 'Summarises calibrated phone-orientation estimates on rides with usable sensors.', 'avenra-halo-v2' ),
					'limitation'        => __( 'This is not motorcycle IMU data and may be omitted when orientation quality is inadequate.', 'avenra-halo-v2' ),
				),
			);

			$base_sufficient = $ride_count >= 3 && $total_miles >= 50;
			$behaviour_available = $speed_available || $dynamic_available;
			$weight_total = 0.0;
			foreach ( $factors as $factor ) {
				if ( $factor['available'] ) {
					$weight_total += (float) $factor['configured_weight'];
				}
			}
			$score = null;
			if ( $base_sufficient && $behaviour_available && $weight_total > 0 ) {
				$score = 0.0;
				foreach ( $factors as $key => $factor ) {
					if ( ! $factor['available'] ) {
						continue;
					}
					$effective = (float) $factor['configured_weight'] / $weight_total * 100;
					$factors[ $key ]['effective_weight'] = round( $effective, 1 );
					$score += (float) $factor['score'] * $effective / 100;
				}
				$score = round( min( 100, max( 0, $score ) ), 1 );
			}

			$risk_level = $this->risk_level( $score );
			$confidence = $this->confidence( $score, $ride_count, $total_miles, (int) $exposure['sample_count'], $dynamic_rides );
			$methodology = array(
				'window_days'          => self::WINDOW_DAYS,
				'maximum_rides'        => self::MAX_RIDES,
				'recency_weighting'    => __( 'None: every eligible ride in the rolling window is weighted equally.', 'avenra-halo-v2' ),
				'minimum_rides'        => 3,
				'minimum_miles'        => 50,
				'eligible_road_rides'  => $ride_count,
				'telemetry_quality'    => $quality_counts,
				'exclusions'           => array( 'track mode', 'test rides', 'simulation rides', 'test incidents' ),
				'uses_demographics'    => false,
				'insufficient_reason'  => $base_sufficient ? ( $behaviour_available ? null : __( 'Recorded speed or motion telemetry is insufficient.', 'avenra-halo-v2' ) ) : __( 'At least three eligible rides and 50 recorded miles are required.', 'avenra-halo-v2' ),
			);
			$disclaimer = __( 'Ride-risk indicator based on recorded phone telemetry. It is not an accident prediction, a safety guarantee, an emergency response decision, or an insurance assessment.', 'avenra-halo-v2' );
			$payload = array(
				'factors'     => $factors,
				'methodology' => $methodology,
				'disclaimer'  => $disclaimer,
			);
			$now = current_time( 'mysql', true );
			$data = array(
				'customer_id'       => $customer_id,
				'score'             => $score,
				'risk_level'        => $risk_level,
				'confidence'        => $confidence,
				'ride_count'        => $ride_count,
				'total_miles'       => round( $total_miles, 3 ),
				'factors_json'      => wp_json_encode( $payload ),
				'model_version'     => self::MODEL_VERSION,
				'window_started_at' => $oldest_started_at ?: null,
				'calculated_at'     => $now,
			);
			if ( false === $wpdb->replace( $risk_table, $data ) ) {
				return $this->empty_profile( $customer_id );
			}
			$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $risk_table ) . '` WHERE customer_id = %d LIMIT 1', $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return $row ? $this->serialise_row( $row ) : $this->empty_profile( $customer_id );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	/** @param array<int,array<string,mixed>> $points @return array<int,array{speed:float,at:?float}> */
	private function speed_observations( array $points ): array {
		$observations = array();
		foreach ( $points as $point ) {
			if ( ! is_array( $point ) ) {
				continue;
			}
			$value = $point['speedMph'] ?? $point['speed_mph'] ?? $point['speed'] ?? null;
			if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
				continue;
			}
			$speed = (float) $value;
			if ( ! is_finite( $speed ) || $speed < 0 || $speed > 250 ) {
				continue;
			}
			$observations[] = array(
				'speed' => $speed,
				'at'    => $this->sample_time( $point['at'] ?? $point['recordedAt'] ?? $point['recorded_at'] ?? $point['timestamp'] ?? null ),
			);
		}
		return $observations;
	}

	/** @param array<string|int,mixed> $decoded @return array<int,array<string,mixed>> */
	private function telemetry_points( array $decoded ): array {
		if ( $decoded === array_values( $decoded ) ) {
			return array_values( array_filter( $decoded, 'is_array' ) );
		}
		foreach ( array( 'points', 'telemetry', 'samples', 'recentTelemetry', 'recent_telemetry' ) as $key ) {
			if ( is_array( $decoded[ $key ] ?? null ) ) {
				return array_values( array_filter( $decoded[ $key ], 'is_array' ) );
			}
		}
		return array();
	}

	/** @param array<int,array{speed:float,at:?float}> $samples @return array<string,float|int> */
	private function speed_exposure( array $samples ): array {
		$seconds = 0.0;
		$bands = array( 60 => 0.0, 70 => 0.0, 90 => 0.0 );
		$count = count( $samples );
		foreach ( $samples as $index => $sample ) {
			$weight = 1.0;
			$next_at = $samples[ $index + 1 ]['at'] ?? null;
			if ( null !== $sample['at'] && null !== $next_at ) {
				$gap = (float) $next_at - (float) $sample['at'];
				if ( $gap >= 0.1 && $gap <= 30 ) {
					$weight = $gap;
				}
			}
			$seconds += $weight;
			foreach ( array_keys( $bands ) as $threshold ) {
				if ( $sample['speed'] >= $threshold ) {
					$bands[ $threshold ] += $weight;
				}
			}
		}
		return array(
			'sample_count'       => $count,
			'observed_seconds'   => $seconds,
			'pct_at_or_above_60' => $seconds > 0 ? $bands[60] / $seconds * 100 : 0.0,
			'pct_at_or_above_70' => $seconds > 0 ? $bands[70] / $seconds * 100 : 0.0,
			'pct_at_or_above_90' => $seconds > 0 ? $bands[90] / $seconds * 100 : 0.0,
		);
	}

	private function sample_time( mixed $value ): ?float {
		if ( null === $value || '' === $value ) {
			return null;
		}
		if ( is_numeric( $value ) ) {
			$number = (float) $value;
			return $number > 100000000000 ? $number / 1000 : $number;
		}
		$timestamp = strtotime( (string) $value );
		return false === $timestamp ? null : (float) $timestamp;
	}

	private function serious_incident_count( int $customer_id, string $window_start ): ?int {
		global $wpdb;

		$table = $this->db->table( 'incidents' );
		if ( ! $this->db->table_exists( $table ) || ! $this->db->has_column( $table, 'emergency_services_called_at' ) ) {
			return null;
		}
		$test_sql = $this->db->has_column( $table, 'is_test' ) ? ' AND is_test = 0' : '';
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM `" . esc_sql( $table ) . "` WHERE customer_id = %d AND occurred_at >= %s AND emergency_services_called_at IS NOT NULL AND source NOT IN ('test','simulation'){$test_sql}", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id,
				$window_start
			)
		);
	}

	private function risk_level( ?float $score ): string {
		if ( null === $score ) {
			return 'insufficient';
		}
		if ( $score < 33 ) {
			return 'lower';
		}
		return $score < 65 ? 'moderate' : 'elevated';
	}

	private function confidence( ?float $score, int $ride_count, float $miles, int $speed_samples, int $dynamic_rides ): string {
		if ( null === $score ) {
			return 'insufficient';
		}
		if ( $ride_count >= 10 && $miles >= 200 && $speed_samples >= 200 && $dynamic_rides >= 5 ) {
			return 'high';
		}
		if ( $ride_count >= 5 && $miles >= 100 && $speed_samples >= 80 ) {
			return 'medium';
		}
		return 'low';
	}

	/** @return array<string,mixed> */
	private function serialise_row( object $row ): array {
		$payload = json_decode( (string) ( $row->factors_json ?? '' ), true );
		$payload = is_array( $payload ) ? $payload : array();
		$score = null !== ( $row->score ?? null ) ? (float) $row->score : null;
		$level = sanitize_key( (string) ( $row->risk_level ?? 'insufficient' ) );
		return array(
			'customer_id'       => (int) $row->customer_id,
			'score'             => $score,
			'score_display'     => null === $score ? __( 'Insufficient data', 'avenra-halo-v2' ) : number_format_i18n( $score, 0 ) . '/100',
			'risk_level'        => $level,
			'risk_label'        => $this->risk_label( $level ),
			'label'             => $this->risk_label( $level ),
			'confidence'        => sanitize_key( (string) ( $row->confidence ?? 'insufficient' ) ),
			'ride_count'        => (int) ( $row->ride_count ?? 0 ),
			'total_miles'       => (float) ( $row->total_miles ?? 0 ),
			'factors'           => is_array( $payload['factors'] ?? null ) ? $payload['factors'] : array(),
			'methodology'       => is_array( $payload['methodology'] ?? null ) ? $payload['methodology'] : array(),
			'disclaimer'        => sanitize_text_field( (string) ( $payload['disclaimer'] ?? $this->default_disclaimer() ) ),
			'model_version'     => sanitize_text_field( (string) ( $row->model_version ?? self::MODEL_VERSION ) ),
			'window_started_at' => $this->rfc3339( $row->window_started_at ?? null ),
			'calculated_at'     => $this->rfc3339( $row->calculated_at ?? null ),
		);
	}

	/** @return array<string,mixed> */
	private function empty_profile( int $customer_id ): array {
		return array(
			'customer_id'       => $customer_id,
			'score'             => null,
			'score_display'     => __( 'Insufficient data', 'avenra-halo-v2' ),
			'risk_level'        => 'insufficient',
			'risk_label'        => __( 'Insufficient data', 'avenra-halo-v2' ),
			'label'             => __( 'Insufficient data', 'avenra-halo-v2' ),
			'confidence'        => 'insufficient',
			'ride_count'        => 0,
			'total_miles'       => 0.0,
			'factors'           => array(),
			'methodology'       => array(
				'window_days'   => self::WINDOW_DAYS,
				'maximum_rides' => self::MAX_RIDES,
				'recency_weighting' => __( 'None: every eligible ride in the rolling window is weighted equally.', 'avenra-halo-v2' ),
				'minimum_rides' => 3,
				'minimum_miles' => 50,
			),
			'disclaimer'        => $this->default_disclaimer(),
			'model_version'     => self::MODEL_VERSION,
			'window_started_at' => null,
			'calculated_at'     => null,
		);
	}

	private function risk_label( string $level ): string {
		return match ( $level ) {
			'lower'    => __( 'Lower indicator', 'avenra-halo-v2' ),
			'moderate' => __( 'Moderate indicator', 'avenra-halo-v2' ),
			'elevated' => __( 'Elevated indicator', 'avenra-halo-v2' ),
			default    => __( 'Insufficient data', 'avenra-halo-v2' ),
		};
	}

	private function default_disclaimer(): string {
		return __( 'Ride-risk indicator based on recorded phone telemetry. It is not an accident prediction, a safety guarantee, an emergency response decision, or an insurance assessment.', 'avenra-halo-v2' );
	}

	private function rfc3339( mixed $value ): ?string {
		if ( null === $value || '' === trim( (string) $value ) ) {
			return null;
		}
		$timestamp = strtotime( (string) $value . ( preg_match( '/(?:Z|[+-]\d\d:\d\d)$/', (string) $value ) ? '' : ' UTC' ) );
		return false === $timestamp ? null : gmdate( DATE_RFC3339, $timestamp );
	}
}
