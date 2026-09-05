<?php

defined( 'ABSPATH' ) || exit;

/**
 * Short-lived customer/app presence for the private Emergency Assist console.
 *
 * A valid Halo session may last for weeks, so it cannot answer whether a rider
 * is online now. Presence rows are instead session-scoped and expire by age.
 * Precise ride data is accepted only under the current Emergency Assist terms.
 */
final class Avenra_Halo_V2_Presence {
	private const NS = 'avenra-halo/v2';
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
	}

	public function register_routes(): void {
		register_rest_route(
			self::NS,
			'/presence',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'heartbeat' ),
				'permission_callback' => array( $this->auth, 'permission_authenticated' ),
			)
		);
	}

	public function heartbeat( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$session     = $this->auth->session();
		$customer_id = $this->auth->customer_id();
		if ( ! $session || $customer_id < 1 || ! $this->db->table_exists( $this->db->table( 'presence' ) ) ) {
			return Avenra_Halo_V2_Response::error( 'presence_unavailable', __( 'Halo presence is temporarily unavailable.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( ! $this->db->consume_rate_limit( 'presence-session', (string) $session->id, 600, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'presence_throttled', __( 'Halo is receiving presence updates too quickly.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 15 ) );
		}

		$body       = $request->get_json_params();
		$body       = is_array( $body ) ? $body : array();
		$consented  = Avenra_Halo_V2_Emergency::instance()->assist_consent( $customer_id );
		$is_riding  = $consented && $this->truthy( $body['riding'] ?? $body['is_riding'] ?? false );
		$client_id  = sanitize_text_field( (string) ( $body['client_ride_id'] ?? $body['ride_id'] ?? '' ) );
		if ( '' !== $client_id && ! preg_match( '/^[A-Za-z0-9._:-]{8,64}$/', $client_id ) ) {
			return Avenra_Halo_V2_Response::error( 'presence_ride_invalid', __( 'The active ride identifier was invalid.', 'avenra-halo-v2' ), 422 );
		}
		$vehicle_id = absint( $body['vehicle_id'] ?? $body['vehicle_order_id'] ?? 0 );
		if ( $vehicle_id && ! $this->db->order_belongs_to_customer( $vehicle_id, $customer_id ) ) {
			return Avenra_Halo_V2_Response::error( 'presence_vehicle_invalid', __( 'That motorcycle is not attached to this Halo account.', 'avenra-halo-v2' ), 422 );
		}

		$lat = $is_riding ? $this->number( $body['lat'] ?? $body['latitude'] ?? null, -90, 90 ) : null;
		$lng = $is_riding ? $this->number( $body['lng'] ?? $body['longitude'] ?? null, -180, 180 ) : null;
		if ( ( null === $lat ) !== ( null === $lng ) ) {
			$lat = null;
			$lng = null;
		}
		$started = $is_riding ? $this->normalise_datetime( $body['started_at'] ?? $body['ride_started_at'] ?? null ) : null;
		$device  = is_array( $body['device_state'] ?? null ) ? $body['device_state'] : array();
		$device  = array(
			'online'     => $this->truthy( $device['online'] ?? true ),
			'visibility' => substr( sanitize_key( (string) ( $device['visibility'] ?? '' ) ), 0, 24 ),
			'network'    => substr( sanitize_text_field( (string) ( $device['network'] ?? $device['effective_type'] ?? '' ) ), 0, 32 ),
		);
		$now = current_time( 'mysql', true );
		$data = array(
			'session_id'          => (int) $session->id,
			'customer_id'         => $customer_id,
			'is_riding'           => $is_riding ? 1 : 0,
			'monitoring_enabled'  => $consented ? 1 : 0,
			'client_ride_id'      => $is_riding && '' !== $client_id ? $client_id : null,
			'vehicle_order_id'    => $is_riding && $vehicle_id ? $vehicle_id : null,
			'ride_started_at'     => $started,
			'speed_mph'           => $is_riding ? $this->number( $body['speed_mph'] ?? $body['speed'] ?? null, 0, 250 ) : null,
			'top_speed_mph'       => $is_riding ? $this->number( $body['top_speed_mph'] ?? $body['top_speed'] ?? null, 0, 250 ) : null,
			'latitude'            => $lat,
			'longitude'           => $lng,
			'accuracy_m'          => $is_riding ? $this->number( $body['accuracy_m'] ?? $body['accuracy'] ?? null, 0, 10000 ) : null,
			'heading'             => $is_riding ? $this->number( $body['heading'] ?? null, 0, 360 ) : null,
			'device_state_json'   => wp_json_encode( $device ),
			'last_ping_at'        => $now,
			'created_at'          => $now,
			'updated_at'          => $now,
		);
		// wpdb's field preparation preserves PHP null values as SQL NULL. That
		// matters here: coercing a missing GPS sample to 0.000000 would put a rider
		// in the Gulf of Guinea on the operator console.
		if ( false === $wpdb->replace( $this->db->table( 'presence' ), $data ) ) {
			return Avenra_Halo_V2_Response::error( 'presence_save_failed', __( 'Halo could not refresh its operations presence.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}

		return Avenra_Halo_V2_Response::success(
			array(
				'online'             => true,
				'monitoring_enabled' => $consented,
				'riding_recorded'    => $is_riding,
				'heartbeat_seconds'  => $is_riding ? 15 : 60,
			)
		);
	}

	public function mark_session_offline( int $session_id ): void {
		global $wpdb;
		if ( $session_id > 0 && $this->db->table_exists( $this->db->table( 'presence' ) ) ) {
			$wpdb->delete( $this->db->table( 'presence' ), array( 'session_id' => $session_id ), array( '%d' ) );
		}
	}

	private function truthy( mixed $value ): bool {
		return in_array( $value, array( true, 1, '1', 'true', 'yes', 'on' ), true );
	}

	private function number( mixed $value, float $minimum, float $maximum ): ?float {
		if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
			return null;
		}
		$number = (float) $value;
		return is_finite( $number ) && $number >= $minimum && $number <= $maximum ? $number : null;
	}

	private function normalise_datetime( mixed $value ): ?string {
		if ( null === $value || '' === trim( (string) $value ) ) {
			return null;
		}
		$timestamp = strtotime( (string) $value );
		if ( false === $timestamp || $timestamp < time() - 7 * DAY_IN_SECONDS || $timestamp > time() + HOUR_IN_SECONDS ) {
			return null;
		}
		return gmdate( 'Y-m-d H:i:s', $timestamp );
	}
}
