<?php

defined( 'ABSPATH' ) || exit;

/**
 * Private, WordPress-authenticated Emergency Assist operations console.
 *
 * Customer Halo sessions and operator WordPress sessions are intentionally
 * separate trust domains. Nothing in this class accepts a customer bearer as
 * authority to view the operations directory or an incident briefing.
 */
final class Avenra_Halo_V2_Operations {
	private const NS = 'avenra-halo/v2';
	private const QUERY_VAR = 'avenra_halo_v2_operations';
	private const CAPS_VERSION = '2';
	private const PAGE_SIZE = 24;

	public const CAP_VIEW = 'avenra_halo_emergency_view';
	public const CAP_OPERATE = 'avenra_halo_emergency_operate';
	public const CAP_DRILL = 'avenra_halo_emergency_drill';
	public const CAP_MEDICAL = 'avenra_halo_emergency_medical';

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

		add_action( 'init', array( $this, 'maybe_install_capabilities' ), 1 );
		add_action( 'init', array( $this, 'register_rewrites' ) );
		add_filter( 'query_vars', array( $this, 'query_vars' ) );
		add_action( 'template_redirect', array( $this, 'serve_console' ), -20 );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/** Install a least-privilege responder role and grant all console caps to administrators. */
	public static function install_capabilities(): void {
		$installed_version = (string) get_option( 'avenra_halo_v2_operations_caps_version', '' );
		if ( self::CAPS_VERSION === $installed_version ) {
			return;
		}
		$initial_install = '' === $installed_version;
		$responder_caps = array(
			'read'             => true,
			self::CAP_VIEW     => true,
			self::CAP_OPERATE  => true,
			self::CAP_DRILL    => true,
		);
		$role = get_role( 'avenra_halo_responder' );
		if ( ! $role ) {
			$role = add_role( 'avenra_halo_responder', __( 'Avenrà Halo Responder', 'avenra-halo-v2' ), $responder_caps );
		}
		if ( $role instanceof WP_Role ) {
			foreach ( $initial_install ? $responder_caps : array( 'read' => true, self::CAP_VIEW => true ) as $capability => $grant ) {
				$role->add_cap( (string) $capability, $grant );
			}
			// Medical access is deliberately a separate, explicitly assigned duty.
			$role->remove_cap( self::CAP_MEDICAL );
		}

		$administrator = get_role( 'administrator' );
		if ( $administrator instanceof WP_Role ) {
			$administrator_defaults = $initial_install
				? array( 'read', self::CAP_VIEW, self::CAP_OPERATE, self::CAP_DRILL, self::CAP_MEDICAL )
				: array( 'read', self::CAP_VIEW );
			foreach ( $administrator_defaults as $capability ) {
				$administrator->add_cap( $capability, true );
			}
		}
		update_option( 'avenra_halo_v2_operations_caps_version', self::CAPS_VERSION, false );
	}

	public function maybe_install_capabilities(): void {
		if ( self::CAPS_VERSION !== (string) get_option( 'avenra_halo_v2_operations_caps_version', '' ) ) {
			self::install_capabilities();
		}
	}

	public function register_rewrites(): void {
		add_rewrite_rule( '^halo-emergency-assist/?$', 'index.php?' . self::QUERY_VAR . '=1', 'top' );
	}

	/** @param string[] $vars @return string[] */
	public function query_vars( array $vars ): array {
		$vars[] = self::QUERY_VAR;
		return array_values( array_unique( $vars ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NS,
			'/operations/dashboard',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'dashboard' ),
				'permission_callback' => array( $this, 'permission_view' ),
			)
		);
		register_rest_route(
			self::NS,
			'/operations/incidents/(?P<id>[a-fA-F0-9-]{36})',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'incident' ),
				'permission_callback' => array( $this, 'permission_view' ),
			)
		);
		register_rest_route(
			self::NS,
			'/operations/incidents/(?P<id>[a-fA-F0-9-]{36})/actions',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'incident_action' ),
				'permission_callback' => array( $this, 'permission_operate' ),
			)
		);
		register_rest_route(
			self::NS,
			'/operations/tests',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'create_test' ),
				'permission_callback' => array( $this, 'permission_drill' ),
			)
		);
	}

	public function permission_view( WP_REST_Request $request ): bool|WP_Error {
		return $this->permission( $request, self::CAP_VIEW );
	}

	public function permission_operate( WP_REST_Request $request ): bool|WP_Error {
		return $this->permission( $request, self::CAP_OPERATE );
	}

	public function permission_drill( WP_REST_Request $request ): bool|WP_Error {
		return $this->permission( $request, self::CAP_DRILL );
	}

	private function permission( WP_REST_Request $request, string $capability ): bool|WP_Error {
		if ( ! is_user_logged_in() ) {
			return new WP_Error( 'halo_operations_login_required', __( 'Sign in with an authorised operator account.', 'avenra-halo-v2' ), array( 'status' => 401 ) );
		}
		if ( ! current_user_can( $capability ) ) {
			return new WP_Error( 'halo_operations_forbidden', __( 'Your account is not authorised for this Emergency Assist action.', 'avenra-halo-v2' ), array( 'status' => 403 ) );
		}

		$nonce = sanitize_text_field( (string) $request->get_header( 'X-WP-Nonce' ) );
		if ( '' === $nonce || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return new WP_Error( 'halo_operations_nonce_invalid', __( 'Your secure operator session expired. Reload the console.', 'avenra-halo-v2' ), array( 'status' => 403 ) );
		}
		if ( ! $this->same_origin_request( $request ) ) {
			return new WP_Error( 'halo_operations_origin_invalid', __( 'The operator request did not originate from this site.', 'avenra-halo-v2' ), array( 'status' => 403 ) );
		}
		return true;
	}

	private function same_origin_request( WP_REST_Request $request ): bool {
		$header = (string) ( $request->get_header( 'Origin' ) ?: $request->get_header( 'Referer' ) );
		if ( '' === trim( $header ) ) {
			// Same-origin GET requests commonly omit both headers. The mandatory,
			// user-bound REST nonce remains the CSRF authority in that case.
			return 'GET' === strtoupper( $request->get_method() );
		}
		$expected_host = strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_HOST ) );
		$actual_host   = strtolower( (string) wp_parse_url( $header, PHP_URL_HOST ) );
		$expected_scheme = strtolower( (string) wp_parse_url( home_url( '/' ), PHP_URL_SCHEME ) );
		$actual_scheme   = strtolower( (string) wp_parse_url( $header, PHP_URL_SCHEME ) );
		$expected_port = (int) ( wp_parse_url( home_url( '/' ), PHP_URL_PORT ) ?: ( 'https' === wp_parse_url( home_url( '/' ), PHP_URL_SCHEME ) ? 443 : 80 ) );
		$actual_port   = (int) ( wp_parse_url( $header, PHP_URL_PORT ) ?: ( 'https' === wp_parse_url( $header, PHP_URL_SCHEME ) ? 443 : 80 ) );
		return '' !== $actual_host && '' !== $actual_scheme && hash_equals( $expected_scheme, $actual_scheme ) && hash_equals( $expected_host, $actual_host ) && $expected_port === $actual_port;
	}

	public function serve_console(): void {
		if ( 1 !== (int) get_query_var( self::QUERY_VAR ) ) {
			return;
		}

		$mode = 'console';
		$status = 200;
		if ( ! is_user_logged_in() ) {
			$mode = 'login';
			$status = 401;
		} elseif ( ! current_user_can( self::CAP_VIEW ) ) {
			$mode = 'forbidden';
			$status = 403;
		}

		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		if ( ! defined( 'DONOTROCKETOPTIMIZE' ) ) {
			define( 'DONOTROCKETOPTIMIZE', true );
		}
		try {
			$csp_nonce = base64_encode( random_bytes( 18 ) );
		} catch ( Throwable $error ) {
			$csp_nonce = wp_generate_password( 28, false, false );
		}
		status_header( $status );
		nocache_headers();
		header( 'Cache-Control: private, no-store, no-cache, must-revalidate, max-age=0', true );
		header( 'CDN-Cache-Control: no-store', true );
		header( 'Cloudflare-CDN-Cache-Control: no-store', true );
		header( 'Surrogate-Control: no-store', true );
		header( 'Referrer-Policy: same-origin', true );
		header( 'X-Frame-Options: DENY', true );
		header( 'X-Content-Type-Options: nosniff', true );
		header( 'X-Robots-Tag: noindex, nofollow, noarchive, nosnippet', true );
		header( 'Permissions-Policy: accelerometer=(), camera=(), gyroscope=(), microphone=(), geolocation=(), payment=(), usb=()', true );
		header( "Content-Security-Policy: default-src 'none'; script-src 'self' 'nonce-" . $csp_nonce . "'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'", true );
		header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ), true );

		$user = wp_get_current_user();
		$halo_operations = array(
			'mode'       => $mode,
			'csp_nonce'  => $csp_nonce,
			'logo'       => defined( 'AVENRA_HALO_V2_BRAND_LOGO' ) ? AVENRA_HALO_V2_BRAND_LOGO : AVENRA_HALO_V2_URL . 'assets/images/avenra-halo-lockup.png',
			'login_url'  => wp_login_url( home_url( '/halo-emergency-assist/' ) ),
			'logout_url' => wp_logout_url( home_url( '/halo-emergency-assist/' ) ),
			'config'     => array(
				'restBase'    => trailingslashit( esc_url_raw( rest_url( self::NS . '/operations' ) ) ),
				'nonce'       => wp_create_nonce( 'wp_rest' ),
				'refreshMs'   => max( 10000, min( 60000, (int) apply_filters( 'avenra_halo_v2_operations_refresh_ms', 15000 ) ) ),
				'operator'    => array(
					'id'      => (int) $user->ID,
					'name'    => sanitize_text_field( (string) $user->display_name ),
					'initials'=> $this->initials( (string) $user->display_name ),
				),
				'capabilities'=> array(
					'operate' => current_user_can( self::CAP_OPERATE ),
					'drill'   => current_user_can( self::CAP_DRILL ),
					'medical' => current_user_can( self::CAP_MEDICAL ),
				),
			),
		);
		$template = AVENRA_HALO_V2_DIR . 'templates/emergency-operations.php';
		if ( ! file_exists( $template ) ) {
			status_header( 503 );
			exit;
		}
		include $template;
		exit;
	}

	public function dashboard( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		global $wpdb;

		if ( ! $this->db->source_tables_ready() ) {
			return new WP_Error( 'halo_operations_source_unavailable', __( 'The Halo customer directory is not available.', 'avenra-halo-v2' ), array( 'status' => 503 ) );
		}
		$customers = $this->customer_index();
		$customer_ids = array_values( array_map( static fn( array $row ): int => (int) $row['id'], $customers ) );
		$sessions = $this->active_sessions();
		$presence = $this->latest_presence();
		$consents = $this->assist_settings();
		$vehicles = $this->latest_vehicles( $customer_ids );
		$test_rides = $this->test_ride_list( $customers, $vehicles );
		$risks = array();
		if ( class_exists( 'Avenra_Halo_V2_Risk' ) && method_exists( Avenra_Halo_V2_Risk::instance(), 'profiles_for_customers' ) ) {
			try {
				$risks = (array) Avenra_Halo_V2_Risk::instance()->profiles_for_customers( $customer_ids, false );
			} catch ( Throwable $error ) {
				$risks = array();
			}
		}

		$search = strtolower( trim( sanitize_text_field( (string) $request->get_param( 'search' ) ) ) );
		$status_filter = sanitize_key( (string) $request->get_param( 'status' ) );
		$allowed_filters = array( 'all', 'riding', 'signal_lost', 'online', 'signed_in', 'offline', 'monitoring_off', 'risk_attention' );
		$status_filter = in_array( $status_filter, $allowed_filters, true ) ? $status_filter : 'all';
		$derived = array();
		$test_candidates = array();
		$summary = array( 'customers' => count( $customers ), 'enrolled' => 0, 'signed_in' => 0, 'online' => 0, 'riding' => 0, 'signal_lost' => 0, 'risk_attention' => 0, 'test_rides' => count( $test_rides ) );

		foreach ( $customers as $customer ) {
			$id = (int) $customer['id'];
			$row = $this->customer_record(
				$customer,
				$sessions[ $id ] ?? null,
				$presence[ $id ] ?? null,
				$consents[ $id ] ?? null,
				$vehicles[ $id ] ?? null,
				$risks[ $id ] ?? null
			);
			if ( $row['assist']['enrolled'] ) {
				++$summary['enrolled'];
				$test_candidates[] = array( 'id' => $row['id'], 'name' => $row['name'], 'email' => $row['email'] );
			}
			foreach ( array( 'signed_in', 'online', 'riding', 'signal_lost' ) as $key ) {
				if ( ! empty( $row['status'][ $key ] ) ) {
					++$summary[ $key ];
				}
			}
			if ( $this->risk_attention( $row['risk'] ) ) {
				++$summary['risk_attention'];
			}

			$haystack = strtolower( implode( ' ', array( $row['name'], $row['email'], $row['vehicle']['model'] ?? '', $row['vehicle']['registration'] ?? '' ) ) );
			if ( '' !== $search && ! str_contains( $haystack, $search ) ) {
				continue;
			}
			if ( ! $this->matches_filter( $row, $status_filter ) ) {
				continue;
			}
			$derived[] = $row;
		}

		usort( $derived, array( $this, 'compare_customers' ) );
		$page = max( 1, absint( $request->get_param( 'page' ) ) );
		$per_page = max( 10, min( 50, absint( $request->get_param( 'per_page' ) ) ?: self::PAGE_SIZE ) );
		$total = count( $derived );
		$total_pages = max( 1, (int) ceil( $total / $per_page ) );
		$page = min( $page, $total_pages );
		$offset = ( $page - 1 ) * $per_page;
		$records = array_slice( $derived, $offset, $per_page );

		$page_ids = array_map( static fn( array $row ): int => (int) $row['id'], $records );
		if ( $page_ids && class_exists( 'Avenra_Halo_V2_Risk' ) && method_exists( Avenra_Halo_V2_Risk::instance(), 'profiles_for_customers' ) ) {
			try {
				$fresh = (array) Avenra_Halo_V2_Risk::instance()->profiles_for_customers( $page_ids, true );
				foreach ( $records as &$record ) {
					if ( isset( $fresh[ (int) $record['id'] ] ) ) {
						$record['risk'] = $this->public_risk( $fresh[ (int) $record['id'] ] );
					}
				}
				unset( $record );
			} catch ( Throwable $error ) {
				// A stale or unavailable model never prevents incident response.
			}
		}

		$incidents = $this->incident_list( $customers );
		$open_incidents = count( array_filter( $incidents, static fn( array $incident ): bool => ! $incident['is_test'] && in_array( $incident['status'], array( 'active', 'acknowledged' ), true ) ) );
		$summary['open_incidents'] = $open_incidents;
		$provider = Avenra_Halo_V2_Emergency::instance()->provider_status();
		$live_tests = defined( 'AVENRA_HALO_ALLOW_LIVE_EMERGENCY_TESTS' ) && true === AVENRA_HALO_ALLOW_LIVE_EMERGENCY_TESTS;
		$audit_key = 'avh2_ops_roster_' . get_current_user_id();
		if ( false === get_transient( $audit_key ) ) {
			$this->audit( 'roster_viewed', 0, 0, array( 'status_filter' => $status_filter ) );
			set_transient( $audit_key, 1, 5 * MINUTE_IN_SECONDS );
		}

		return $this->response(
			array(
				'generated_at' => gmdate( DATE_RFC3339 ),
				'summary'      => $summary,
				'incidents'    => $incidents,
				'test_rides'   => $test_rides,
				'customers'    => $records,
				'pagination'   => array( 'page' => $page, 'per_page' => $per_page, 'total' => $total, 'total_pages' => $total_pages ),
				'filters'      => array( 'search' => $search, 'status' => $status_filter ),
				'test_candidates' => $test_candidates,
				'provider' => array(
					'ready'              => ! empty( $provider['ready'] ),
					'sms_adapter'        => sanitize_key( (string) ( $provider['sms_adapter'] ?? 'unavailable' ) ),
					'primary_last_four'  => sanitize_text_field( (string) ( $provider['primary_last_four'] ?? '' ) ),
					'backup_last_four'   => sanitize_text_field( (string) ( $provider['backup_last_four'] ?? '' ) ),
					'action_scheduler'   => ! empty( $provider['action_scheduler'] ),
				),
				'testing' => array(
					'dry_run_enabled'  => true,
					'live_sms_enabled' => $live_tests && ! empty( $provider['ready'] ),
					'live_guard'       => $live_tests,
					'confirmation'     => 'SEND TEST SMS',
				),
			)
		);
	}

	public function incident( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$id = strtolower( sanitize_text_field( (string) $request['id'] ) );
		$state = $this->incident_state( $id );
		if ( ! is_array( $state ) ) {
			return new WP_Error( 'halo_operations_incident_missing', __( 'That incident is unavailable.', 'avenra-halo-v2' ), array( 'status' => 404 ) );
		}
		if ( in_array( $state['status'], array( 'candidate', 'cancelled' ), true ) ) {
			// A candidate is still inside the rider cancellation window; a
			// cancelled candidate is no longer operational evidence. Neither may
			// expose its encrypted briefing through the operator API.
			return $this->response(
				array(
					'incident' => array(
						'public_id'         => $id,
						'status'            => $state['status'],
						'is_test'           => $state['is_test'],
						'actionable'        => false,
						'pending_countdown' => 'candidate' === $state['status'],
					),
					'snapshot' => array(),
					'redacted' => true,
				)
			);
		}
		$emergency = Avenra_Halo_V2_Emergency::instance();
		if ( ! method_exists( $emergency, 'operator_incident_briefing' ) ) {
			return new WP_Error( 'halo_operations_incident_api_unavailable', __( 'The private incident briefing API is not ready.', 'avenra-halo-v2' ), array( 'status' => 503 ) );
		}
		$result = $emergency->operator_incident_briefing( $id, get_current_user_id() );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$this->audit( 'incident_viewed', $this->incident_internal_id( $id ), 0, array() );
		return $this->response( $result );
	}

	public function incident_action( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$id = strtolower( sanitize_text_field( (string) $request['id'] ) );
		$state = $this->incident_state( $id );
		if ( ! is_array( $state ) || ! in_array( $state['status'], array( 'active', 'acknowledged' ), true ) ) {
			return new WP_Error( 'halo_operations_incident_not_actionable', __( 'This incident is not in the responder action queue.', 'avenra-halo-v2' ), array( 'status' => 409 ) );
		}
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$action = sanitize_key( (string) ( $body['action'] ?? '' ) );
		$allowed = array( 'acknowledge', 'rider_no_answer', 'rider_confirmed', 'false_alarm', 'emergency_services_called', 'alert_next_of_kin', 'handover_complete', 'test_complete' );
		if ( ! in_array( $action, $allowed, true ) ) {
			return new WP_Error( 'halo_operations_action_invalid', __( 'That incident action is unavailable.', 'avenra-halo-v2' ), array( 'status' => 400 ) );
		}
		$user = wp_get_current_user();
		$emergency = Avenra_Halo_V2_Emergency::instance();
		if ( ! method_exists( $emergency, 'operator_action' ) ) {
			return new WP_Error( 'halo_operations_action_api_unavailable', __( 'The operator action API is not ready.', 'avenra-halo-v2' ), array( 'status' => 503 ) );
		}
		$result = $emergency->operator_action( $id, $action, (int) $user->ID, sanitize_text_field( (string) $user->display_name ) );
		$internal_id = $this->incident_internal_id( $id );
		if ( is_wp_error( $result ) ) {
			$this->audit( 'incident_action_failed', $internal_id, 0, array( 'action' => $action, 'code' => $result->get_error_code() ) );
			return $result;
		}
		$this->audit( 'incident_action', $internal_id, 0, array( 'action' => $action ) );
		return $this->response( $result );
	}

	public function create_test( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$customer_id = absint( $body['customer_id'] ?? 0 );
		$mode = sanitize_key( (string) ( $body['mode'] ?? 'dry_run' ) );
		$scenario = sanitize_key( (string) ( $body['scenario'] ?? 'happy_path' ) );
		if ( ! in_array( $mode, array( 'dry_run', 'live_sms' ), true ) || ! in_array( $scenario, array( 'happy_path', 'primary_rejected', 'primary_timeout', 'no_ack_fallback' ), true ) ) {
			return new WP_Error( 'halo_operations_test_invalid', __( 'Choose a valid drill mode and scenario.', 'avenra-halo-v2' ), array( 'status' => 400 ) );
		}
		if ( 'live_sms' === $mode && ! in_array( $scenario, array( 'happy_path', 'no_ack_fallback' ), true ) ) {
			return new WP_Error( 'halo_operations_live_scenario_invalid', __( 'Provider rejection and timeout simulations are dry-run scenarios only.', 'avenra-halo-v2' ), array( 'status' => 400 ) );
		}
		if ( $customer_id < 1 || ! $this->db->customer_by_id( $customer_id ) ) {
			return new WP_Error( 'halo_operations_test_customer_missing', __( 'Choose a Halo customer for this drill.', 'avenra-halo-v2' ), array( 'status' => 400 ) );
		}
		$emergency = Avenra_Halo_V2_Emergency::instance();
		if ( ! $emergency->has_assist_consent( $customer_id ) ) {
			return new WP_Error( 'halo_operations_test_consent_required', __( 'The selected rider has not accepted the current Emergency Assist terms.', 'avenra-halo-v2' ), array( 'status' => 409 ) );
		}

		$user_id = get_current_user_id();
		if ( 'live_sms' === $mode ) {
			$enabled = defined( 'AVENRA_HALO_ALLOW_LIVE_EMERGENCY_TESTS' ) && true === AVENRA_HALO_ALLOW_LIVE_EMERGENCY_TESTS;
			$confirmation = sanitize_text_field( (string) ( $body['confirmation'] ?? '' ) );
			if ( ! $enabled ) {
				return new WP_Error( 'halo_operations_live_test_disabled', __( 'Live SMS drills are disabled in server configuration.', 'avenra-halo-v2' ), array( 'status' => 403 ) );
			}
			if ( ! hash_equals( 'SEND TEST SMS', $confirmation ) ) {
				return new WP_Error( 'halo_operations_live_test_confirmation', __( 'Type the exact live-drill confirmation phrase.', 'avenra-halo-v2' ), array( 'status' => 400 ) );
			}
			if ( ! $emergency->provider_ready() ) {
				return new WP_Error( 'halo_operations_provider_unavailable', __( 'Responder SMS delivery is not ready.', 'avenra-halo-v2' ), array( 'status' => 503 ) );
			}
			if ( ! $this->db->consume_rate_limit( 'operations-live-drill', (string) $user_id, 3, HOUR_IN_SECONDS ) ) {
				return new WP_Error( 'halo_operations_live_test_rate_limited', __( 'The live-drill limit has been reached. Wait before sending another test.', 'avenra-halo-v2' ), array( 'status' => 429 ) );
			}
		} elseif ( ! $this->db->consume_rate_limit( 'operations-dry-drill', (string) $user_id, 30, HOUR_IN_SECONDS ) ) {
			return new WP_Error( 'halo_operations_test_rate_limited', __( 'The dry-run limit has been reached. Wait before starting another drill.', 'avenra-halo-v2' ), array( 'status' => 429 ) );
		}

		$lat = $this->number( $body['lat'] ?? 53.7185, -90, 90, 53.7185 );
		$lng = $this->number( $body['lng'] ?? -1.2591, -180, 180, -1.2591 );
		$speed = $this->number( $body['speed_mph'] ?? 42, 0, 180, 42 );
		$peak_g = $this->number( $body['peak_g_force'] ?? 2.6, 0, 20, 2.6 );
		$event_id = 'ops-test-' . gmdate( 'YmdHis' ) . '-' . strtolower( wp_generate_password( 8, false, false ) );
		$snapshot = array(
			'test_dispatch_mode' => $mode,
			'test_scenario'      => $scenario,
			'occurred_at'        => gmdate( DATE_RFC3339 ),
			'client_ride_id'     => 'operator-drill-' . gmdate( 'Ymd' ),
			'location'           => array( 'lat' => $lat, 'lng' => $lng, 'accuracy_m' => 8, 'heading' => 90, 'source' => 'operator_drill' ),
			'impact'             => array( 'speed_mph' => $speed, 'prior_speed_mph' => $speed, 'top_speed_mph' => $speed, 'peak_g_force' => $peak_g, 'axes' => array( 'x' => $peak_g, 'y' => 0.4, 'z' => 1.1 ) ),
			'device_state'       => array( 'network' => array( 'online' => true, 'effective_type' => 'test' ), 'screen_orientation' => 'operator_drill' ),
			'movement'           => 'controlled Emergency Assist exercise',
		);
		$source = 'live_sms' === $mode ? 'test' : 'simulation';
		$this->audit( 'test_requested', 0, $customer_id, array( 'mode' => $mode, 'scenario' => $scenario ) );
		$result = $emergency->activate( $customer_id, $event_id, $snapshot, $source );
		if ( is_wp_error( $result ) ) {
			$this->audit( 'test_failed', 0, $customer_id, array( 'mode' => $mode, 'scenario' => $scenario, 'code' => $result->get_error_code() ) );
			return $result;
		}
		$test_public_id = sanitize_text_field( (string) ( $result['incident_id'] ?? $result['id'] ?? '' ) );
		$this->audit( 'test_created', '' !== $test_public_id ? $this->incident_internal_id( $test_public_id ) : 0, $customer_id, array( 'mode' => $mode, 'scenario' => $scenario ) );
		$response = $this->response( array( 'message' => 'dry_run' === $mode ? __( 'Dry-run incident created. No SMS was sent.', 'avenra-halo-v2' ) : __( 'Live test messages entered the responder escalation path.', 'avenra-halo-v2' ), 'incident' => $result ) );
		$response->set_status( 201 );
		return $response;
	}

	/** @return array<int,array<string,mixed>> */
	private function customer_index(): array {
		global $wpdb;

		$table = $this->db->table( 'customers' );
		$wanted = array( 'id', 'full_name', 'first_name', 'last_name', 'email_address', 'mobile_number', 'created_at', 'last_login_at' );
		$columns = array_values( array_filter( $wanted, fn( string $column ): bool => $this->db->has_column( $table, $column ) ) );
		if ( ! in_array( 'id', $columns, true ) ) {
			return array();
		}
		$select = implode( ',', array_map( static fn( string $column ): string => '`' . esc_sql( $column ) . '`', $columns ) );
		$rows = $wpdb->get_results( 'SELECT ' . $select . ' FROM `' . esc_sql( $table ) . '` ORDER BY id DESC', ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_array( $rows ) ? $rows : array();
	}

	/** @return array<int,array<string,mixed>> */
	private function active_sessions(): array {
		global $wpdb;
		$table = $this->db->table( 'sessions' );
		if ( ! $this->db->table_exists( $table ) ) {
			return array();
		}
		$now = current_time( 'mysql', true );
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT customer_id, MAX(last_seen_at) AS last_seen_at, COUNT(*) AS session_count FROM `' . esc_sql( $table ) . '` WHERE revoked_at IS NULL AND expires_at > %s GROUP BY customer_id', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$now
			),
			ARRAY_A
		);
		$map = array();
		foreach ( (array) $rows as $row ) {
			$map[ (int) $row['customer_id'] ] = $row;
		}
		return $map;
	}

	/** @return array<int,array<string,mixed>> */
	private function latest_presence(): array {
		global $wpdb;
		$presence = $this->db->table( 'presence' );
		$sessions = $this->db->table( 'sessions' );
		if ( ! $this->db->table_exists( $presence ) || ! $this->db->table_exists( $sessions ) ) {
			return array();
		}
		$now = current_time( 'mysql', true );
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT p.* FROM `' . esc_sql( $presence ) . '` p INNER JOIN `' . esc_sql( $sessions ) . '` s ON s.id = p.session_id WHERE s.revoked_at IS NULL AND s.expires_at > %s ORDER BY p.last_ping_at DESC', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$now
			),
			ARRAY_A
		);
		$map = array();
		foreach ( (array) $rows as $row ) {
			$id = (int) $row['customer_id'];
			if ( ! isset( $map[ $id ] ) ) {
				$map[ $id ] = $row;
			}
		}
		return $map;
	}

	/**
	 * Return the bounded operational view of active Avenra test rides.
	 *
	 * Public live-share credentials are deliberately excluded from both the SQL
	 * projection and the response. The stable UUID is only an internal console
	 * locator; every monitor URL still requires the normal WordPress operator
	 * session, capability, REST nonce and same-origin checks.
	 *
	 * @param array<int,array<string,mixed>> $customers Source customer records.
	 * @param array<int,array<string,mixed>> $vehicles  Latest safe vehicle summaries keyed by customer ID.
	 * @return array<int,array<string,mixed>>
	 */
	private function test_ride_list( array $customers, array $vehicles ): array {
		global $wpdb;

		$table = $this->db->table( 'live_tracking' );
		$required_columns = array(
			'public_id', 'customer_id', 'client_ride_id', 'tracking_mode', 'started_at', 'expires_at', 'ended_at',
			'latitude', 'longitude', 'speed_mph', 'top_speed_mph', 'road_name', 'heading', 'accuracy_m', 'last_ping_at',
		);
		if ( ! $this->db->table_exists( $table ) ) {
			return array();
		}
		foreach ( $required_columns as $column ) {
			if ( ! $this->db->has_column( $table, $column ) ) {
				// Keep the response console available while a database migration is
				// incomplete; never fall back to unscoped live-sharing rows.
				return array();
			}
		}

		$customer_map = array();
		foreach ( $customers as $customer ) {
			$customer_id = absint( $customer['id'] ?? 0 );
			if ( $customer_id > 0 ) {
				$customer_map[ $customer_id ] = $customer;
			}
		}

		$now = current_time( 'mysql', true );
		$rows = $wpdb->get_results(
			$wpdb->prepare(
					"SELECT public_id, customer_id, client_ride_id, started_at, expires_at, latitude, longitude, speed_mph, top_speed_mph, road_name, heading, accuracy_m, last_ping_at FROM `" . esc_sql( $table ) . "` WHERE tracking_mode = %s AND ended_at IS NULL AND expires_at > %s ORDER BY COALESCE(last_ping_at, started_at) DESC, id DESC LIMIT 100",
				'test_ride',
				$now
			),
			ARRAY_A
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- table is selected from the plugin-owned allowlist.

		$output = array();
		foreach ( (array) $rows as $row ) {
			$public_id = strtolower( sanitize_text_field( (string) ( $row['public_id'] ?? '' ) ) );
			if ( ! preg_match( '/^[a-f0-9-]{36}$/', $public_id ) ) {
				continue;
			}

			$customer_id = absint( $row['customer_id'] ?? 0 );
			$customer = $customer_map[ $customer_id ] ?? null;
			$vehicle = is_array( $vehicles[ $customer_id ] ?? null ) ? $vehicles[ $customer_id ] : null;
			$last_ping_at = $this->rfc3339( $row['last_ping_at'] ?? null );
			$ping_age = $this->age_seconds( $row['last_ping_at'] ?? null );
			if ( null === $last_ping_at ) {
				$status = 'waiting';
			} elseif ( null !== $ping_age && $ping_age <= 45 ) {
				$status = 'active';
			} elseif ( null !== $ping_age && $ping_age <= 300 ) {
				$status = 'signal_lost';
			} else {
				$status = 'stale';
			}

			$latitude = $this->bounded_nullable_number( $row['latitude'] ?? null, -90, 90, 7 );
			$longitude = $this->bounded_nullable_number( $row['longitude'] ?? null, -180, 180, 7 );
			$has_location = null !== $latitude && null !== $longitude;
			$map_url = null;
			if ( $has_location ) {
				$lat_string = number_format( $latitude, 7, '.', '' );
				$lng_string = number_format( $longitude, 7, '.', '' );
				$map_url = esc_url_raw( 'https://www.openstreetmap.org/?mlat=' . rawurlencode( $lat_string ) . '&mlon=' . rawurlencode( $lng_string ) . '#map=17/' . rawurlencode( $lat_string ) . '/' . rawurlencode( $lng_string ) );
			}

			$rider_name = is_array( $customer ) ? $this->customer_name( $customer ) : sprintf( __( 'Rider #%d', 'avenra-halo-v2' ), $customer_id );
			$rider_email = is_array( $customer ) ? sanitize_email( (string) ( $customer['email_address'] ?? '' ) ) : '';
			$bike = $vehicle ? array(
				// This is the customer's latest Halo-linked motorcycle, not proof
				// that the physical demonstrator carrying the phone is that bike.
				'identified'   => false,
				'linked'       => true,
				'model'        => sanitize_text_field( (string) ( $vehicle['model'] ?? '' ) ),
				'registration' => strtoupper( sanitize_text_field( (string) ( $vehicle['registration'] ?? '' ) ) ),
			) : array(
				'identified'   => false,
				'linked'       => false,
				'model'        => '',
				'registration' => '',
			);

			$output[] = array(
				'id'             => $public_id,
				'session_id'     => $public_id,
				'client_ride_id' => sanitize_text_field( (string) ( $row['client_ride_id'] ?? '' ) ),
				'customer_id'    => $customer_id,
				'rider'          => array( 'name' => $rider_name, 'email' => $rider_email ),
				'bike'           => $bike,
				'status'         => $status,
				'started_at'     => $this->rfc3339( $row['started_at'] ?? null ),
				'expires_at'     => $this->rfc3339( $row['expires_at'] ?? null ),
				'last_update_at' => $last_ping_at,
				'last_ping_at'   => $last_ping_at,
				'latitude'       => $latitude,
				'longitude'      => $longitude,
				'road_name'      => sanitize_text_field( (string) ( $row['road_name'] ?? '' ) ),
				'speed_mph'      => null !== $last_ping_at ? $this->bounded_nullable_number( $row['speed_mph'] ?? null, 0, 250, 2 ) : null,
				'top_speed_mph'  => null !== $last_ping_at ? $this->bounded_nullable_number( $row['top_speed_mph'] ?? null, 0, 250, 2 ) : null,
				'heading'        => $this->bounded_nullable_number( $row['heading'] ?? null, 0, 360, 2 ),
				'accuracy_m'     => $this->bounded_nullable_number( $row['accuracy_m'] ?? null, 0, 10000, 2 ),
				'monitor_url'    => esc_url_raw( add_query_arg( 'test_ride', rawurlencode( $public_id ), home_url( '/halo-emergency-assist/' ) ) ),
				'map_url'        => $map_url,
			);
		}

		$priority = array( 'active' => 0, 'waiting' => 1, 'signal_lost' => 2, 'stale' => 3 );
		usort(
			$output,
			static function ( array $left, array $right ) use ( $priority ): int {
				$order = ( $priority[ (string) $left['status'] ] ?? 9 ) <=> ( $priority[ (string) $right['status'] ] ?? 9 );
				if ( 0 !== $order ) {
					return $order;
				}
				return strcmp( (string) ( $right['last_update_at'] ?? $right['started_at'] ?? '' ), (string) ( $left['last_update_at'] ?? $left['started_at'] ?? '' ) );
			}
		);

		return $output;
	}

	/** @return array<int,array<string,mixed>> */
	private function assist_settings(): array {
		global $wpdb;
		$table = $this->db->table( 'emergency_settings' );
		if ( ! $this->db->table_exists( $table ) ) {
			return array();
		}
		$rows = $wpdb->get_results( 'SELECT customer_id, assist_enabled, consent_version, consented_at, revoked_at FROM `' . esc_sql( $table ) . '`', ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$map = array();
		foreach ( (array) $rows as $row ) {
			$map[ (int) $row['customer_id'] ] = $row;
		}
		return $map;
	}

	/** @param int[] $customer_ids @return array<int,array<string,mixed>> */
	private function latest_vehicles( array $customer_ids ): array {
		global $wpdb;
		$table = $this->db->table( 'orders' );
		if ( ! $customer_ids || ! $this->db->table_exists( $table ) ) {
			return array();
		}
		$wanted = array( 'id', 'customer_id', 'model', 'color', 'colour', 'registration_plate', 'vin', 'order_status', 'order_date' );
		$columns = array_values( array_filter( $wanted, fn( string $column ): bool => $this->db->has_column( $table, $column ) ) );
		if ( ! in_array( 'customer_id', $columns, true ) ) {
			return array();
		}
		$select = implode( ',', array_map( static fn( string $column ): string => '`' . esc_sql( $column ) . '`', $columns ) );
		$order = in_array( 'order_date', $columns, true ) ? 'customer_id ASC, order_date DESC, id DESC' : 'customer_id ASC, id DESC';
		$map = array();
		foreach ( array_chunk( array_values( array_unique( array_map( 'absint', $customer_ids ) ) ), 500 ) as $chunk ) {
			$in = implode( ',', $chunk );
			$rows = $wpdb->get_results( 'SELECT ' . $select . ' FROM `' . esc_sql( $table ) . '` WHERE customer_id IN (' . $in . ') ORDER BY ' . $order, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared -- integer-only IN list.
			foreach ( (array) $rows as $row ) {
				$id = (int) $row['customer_id'];
				if ( ! isset( $map[ $id ] ) ) {
					$map[ $id ] = $this->public_vehicle( $row );
				}
			}
		}
		return $map;
	}

	/** @param array<int,array<string,mixed>> $customers @return array<int,array<string,mixed>> */
	private function incident_list( array $customers ): array {
		global $wpdb;
		$table = $this->db->table( 'incidents' );
		if ( ! $this->db->table_exists( $table ) ) {
			return array();
		}
		$names = array();
		foreach ( $customers as $customer ) {
			$names[ (int) $customer['id'] ] = $this->customer_name( $customer );
		}
		$sql = "SELECT id, public_id, customer_id, source, is_test, test_dispatch_mode, test_scenario, status, occurred_at, activation_due_at, activated_at, primary_status, primary_sent_at, backup_status, backup_sent_at, first_acknowledged_at, first_acknowledged_by, rider_call_result, emergency_services_called_at, nok_notification_status, resolved_at FROM `" . esc_sql( $table ) . "` ORDER BY CASE WHEN status IN ('active','acknowledged') THEN 0 WHEN status = 'candidate' THEN 1 ELSE 2 END, occurred_at DESC, id DESC LIMIT 80";
		$rows = $wpdb->get_results( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$output = array();
		foreach ( (array) $rows as $row ) {
			$customer_id = (int) $row['customer_id'];
			$status = sanitize_key( (string) $row['status'] );
			$identity_redacted = in_array( $status, array( 'candidate', 'cancelled' ), true );
			$output[] = array(
				'id'                    => sanitize_text_field( (string) $row['public_id'] ),
				'customer_id'           => $identity_redacted ? null : $customer_id,
				'rider_name'            => $identity_redacted
					? ( 'candidate' === $status ? __( 'Pending rider confirmation', 'avenra-halo-v2' ) : __( 'Cancelled alert', 'avenra-halo-v2' ) )
					: ( $names[ $customer_id ] ?? sprintf( __( 'Rider #%d', 'avenra-halo-v2' ), $customer_id ) ),
				'source'                => sanitize_key( (string) $row['source'] ),
				'is_test'               => '1' === (string) $row['is_test'],
				'test_dispatch_mode'    => sanitize_key( (string) ( $row['test_dispatch_mode'] ?? '' ) ),
				'test_scenario'         => sanitize_key( (string) ( $row['test_scenario'] ?? '' ) ),
				'status'                => $status,
				'display_status'        => 'candidate' === $status ? 'pending_countdown' : $status,
				'actionable'            => in_array( $status, array( 'active', 'acknowledged' ), true ),
				'occurred_at'           => $this->rfc3339( $row['occurred_at'] ?? null ),
				'activation_due_at'     => $this->rfc3339( $row['activation_due_at'] ?? null ),
				'activated_at'          => $this->rfc3339( $row['activated_at'] ?? null ),
				'primary_status'        => sanitize_key( (string) $row['primary_status'] ),
				'primary_sent_at'       => $this->rfc3339( $row['primary_sent_at'] ?? null ),
				'backup_status'         => sanitize_key( (string) $row['backup_status'] ),
				'backup_sent_at'        => $this->rfc3339( $row['backup_sent_at'] ?? null ),
				'acknowledged_at'       => $this->rfc3339( $row['first_acknowledged_at'] ?? null ),
				'acknowledged_by'       => sanitize_key( (string) ( $row['first_acknowledged_by'] ?? '' ) ),
				'rider_call_result'     => sanitize_key( (string) ( $row['rider_call_result'] ?? '' ) ),
				'emergency_called_at'   => $this->rfc3339( $row['emergency_services_called_at'] ?? null ),
				'nok_status'            => sanitize_key( (string) ( $row['nok_notification_status'] ?? '' ) ),
				'resolved_at'           => $this->rfc3339( $row['resolved_at'] ?? null ),
			);
		}
		return $output;
	}

	/** @return array<string,mixed> */
	private function customer_record( array $customer, ?array $session, ?array $presence, ?array $consent, ?array $vehicle, mixed $risk ): array {
		$id = (int) $customer['id'];
		$required = Avenra_Halo_V2_Emergency::instance()->required_consent_version();
		$enrolled = is_array( $consent ) && '1' === (string) ( $consent['assist_enabled'] ?? '0' ) && hash_equals( $required, (string) ( $consent['consent_version'] ?? '' ) );
		$session_age = $this->age_seconds( $session['last_seen_at'] ?? null );
		$presence_age = $this->age_seconds( $presence['last_ping_at'] ?? null );
		$signed_in = is_array( $session );
		$online = $enrolled && ( null !== $presence_age ? $presence_age <= 90 : ( null !== $session_age && $session_age <= 300 ) );
		$monitoring = $enrolled && is_array( $presence ) && '1' === (string) ( $presence['monitoring_enabled'] ?? '0' );
		$ride_signal = $monitoring && '1' === (string) ( $presence['is_riding'] ?? '0' );
		$riding = $ride_signal && null !== $presence_age && $presence_age <= 45;
		$signal_lost = $ride_signal && null !== $presence_age && $presence_age > 45 && $presence_age <= 300;

		return array(
			'id'            => $id,
			'name'          => $this->customer_name( $customer ),
			'email'         => sanitize_email( (string) ( $customer['email_address'] ?? '' ) ),
			'mobile_masked' => $this->mask_phone( (string) ( $customer['mobile_number'] ?? '' ) ),
			'created_at'    => $this->rfc3339( $customer['created_at'] ?? null ),
			'last_login_at' => $this->rfc3339( $customer['last_login_at'] ?? null ),
			'assist'        => array(
				'enrolled'         => $enrolled,
				'visibility'       => $enrolled ? 'consented' : 'not_consented',
				'consented_at'     => $enrolled ? $this->rfc3339( $consent['consented_at'] ?? null ) : null,
			),
			'status'        => array(
				'signed_in'    => $signed_in,
				'online'       => $online,
				'riding'       => $riding,
				'signal_lost'  => $signal_lost,
				'monitoring'   => $monitoring,
				'session_count'=> $signed_in ? (int) ( $session['session_count'] ?? 1 ) : 0,
				'last_seen_at' => $this->rfc3339( $session['last_seen_at'] ?? null ),
				'last_ping_at' => $enrolled ? $this->rfc3339( $presence['last_ping_at'] ?? null ) : null,
			),
			'presence'      => $enrolled && is_array( $presence ) ? array(
				'speed_mph'      => $this->nullable_number( $presence['speed_mph'] ?? null ),
				'top_speed_mph'  => $this->nullable_number( $presence['top_speed_mph'] ?? null ),
				'latitude'       => $this->nullable_number( $presence['latitude'] ?? null ),
				'longitude'      => $this->nullable_number( $presence['longitude'] ?? null ),
				'accuracy_m'     => $this->nullable_number( $presence['accuracy_m'] ?? null ),
				'heading'        => $this->nullable_number( $presence['heading'] ?? null ),
				'ride_started_at'=> $this->rfc3339( $presence['ride_started_at'] ?? null ),
				'client_ride_id' => sanitize_text_field( (string) ( $presence['client_ride_id'] ?? '' ) ),
			) : null,
			'vehicle'       => $vehicle,
			'risk'          => $this->public_risk( $risk ),
		);
	}

	private function matches_filter( array $row, string $filter ): bool {
		return match ( $filter ) {
			'riding'         => ! empty( $row['status']['riding'] ),
			'signal_lost'    => ! empty( $row['status']['signal_lost'] ),
			'online'         => ! empty( $row['status']['online'] ),
			'signed_in'      => ! empty( $row['status']['signed_in'] ),
			'offline'        => empty( $row['status']['online'] ),
			'monitoring_off' => empty( $row['assist']['enrolled'] ),
			'risk_attention' => $this->risk_attention( $row['risk'] ),
			default          => true,
		};
	}

	private function compare_customers( array $left, array $right ): int {
		$priority = static function ( array $row ): int {
			if ( ! empty( $row['status']['riding'] ) ) {
				return 0;
			}
			if ( ! empty( $row['status']['signal_lost'] ) ) {
				return 1;
			}
			if ( ! empty( $row['status']['online'] ) ) {
				return 2;
			}
			if ( ! empty( $row['status']['signed_in'] ) ) {
				return 3;
			}
			return 4;
		};
		$order = $priority( $left ) <=> $priority( $right );
		return 0 !== $order ? $order : strcasecmp( (string) $left['name'], (string) $right['name'] );
	}

	/** @return array<string,mixed>|null */
	private function public_vehicle( array $row ): ?array {
		$model = sanitize_text_field( (string) ( $row['model'] ?? '' ) );
		$colour = sanitize_text_field( (string) ( $row['color'] ?? $row['colour'] ?? '' ) );
		$registration = strtoupper( sanitize_text_field( (string) ( $row['registration_plate'] ?? '' ) ) );
		$vin = strtoupper( preg_replace( '/[^A-HJ-NPR-Z0-9]/', '', (string) ( $row['vin'] ?? '' ) ) );
		if ( '' === $model && '' === $colour && '' === $registration && '' === $vin ) {
			return null;
		}
		return array(
			'id'           => (int) ( $row['id'] ?? 0 ),
			'model'        => $model,
			'colour'       => $colour,
			'registration' => $registration,
			'vin_masked'   => strlen( $vin ) > 7 ? substr( $vin, 0, 3 ) . str_repeat( '•', max( 3, strlen( $vin ) - 7 ) ) . substr( $vin, -4 ) : $vin,
			'status'       => sanitize_text_field( (string) ( $row['order_status'] ?? '' ) ),
		);
	}

	/** @return array<string,mixed> */
	private function public_risk( mixed $risk ): array {
		if ( ! is_array( $risk ) ) {
			return array(
				'score' => null, 'risk_level' => 'insufficient', 'confidence' => 'insufficient', 'ride_count' => 0, 'total_miles' => 0,
				'factors' => array(), 'label' => __( 'Not enough ride data', 'avenra-halo-v2' ),
				'disclaimer' => __( 'A ride-history indicator, not an accident prediction or insurance rating.', 'avenra-halo-v2' ),
			);
		}
		$factors = is_array( $risk['factors'] ?? null ) ? $risk['factors'] : array();
		return array(
			'score'        => is_numeric( $risk['score'] ?? null ) ? round( (float) $risk['score'], 1 ) : null,
			'risk_level'   => sanitize_key( (string) ( $risk['risk_level'] ?? 'insufficient' ) ),
			'confidence'   => sanitize_key( (string) ( $risk['confidence'] ?? 'insufficient' ) ),
			'ride_count'   => absint( $risk['ride_count'] ?? 0 ),
			'total_miles'  => round( (float) ( $risk['total_miles'] ?? 0 ), 1 ),
			'factors'      => $this->safe_factors( $factors ),
			'label'        => sanitize_text_field( (string) ( $risk['label'] ?? $risk['risk_label'] ?? __( 'Ride-risk indicator', 'avenra-halo-v2' ) ) ),
			'disclaimer'   => sanitize_text_field( (string) ( $risk['disclaimer'] ?? __( 'A ride-history indicator, not an accident prediction or insurance rating.', 'avenra-halo-v2' ) ) ),
			'calculated_at'=> $this->rfc3339( $risk['calculated_at'] ?? null ),
		);
	}

	/** @return array<string,mixed> */
	private function safe_factors( array $factors ): array {
		$output = array();
		foreach ( array_slice( $factors, 0, 12, true ) as $key => $value ) {
			$key = sanitize_key( (string) $key );
			if ( '' === $key ) {
				continue;
			}
			if ( is_array( $value ) ) {
				$output[ $key ] = array();
				foreach ( array_slice( $value, 0, 8, true ) as $sub_key => $sub_value ) {
					$sub_key = sanitize_key( (string) $sub_key );
					if ( is_scalar( $sub_value ) || null === $sub_value ) {
						$output[ $key ][ $sub_key ] = is_string( $sub_value ) ? sanitize_text_field( $sub_value ) : $sub_value;
					} elseif ( is_array( $sub_value ) ) {
						$output[ $key ][ $sub_key ] = array();
						foreach ( array_slice( $sub_value, 0, 12, true ) as $measure_key => $measure_value ) {
							if ( is_scalar( $measure_value ) || null === $measure_value ) {
								$output[ $key ][ $sub_key ][ sanitize_key( (string) $measure_key ) ] = is_string( $measure_value ) ? sanitize_text_field( $measure_value ) : $measure_value;
							}
						}
					}
				}
			} elseif ( is_scalar( $value ) || null === $value ) {
				$output[ $key ] = is_string( $value ) ? sanitize_text_field( $value ) : $value;
			}
		}
		return $output;
	}

	private function risk_attention( array $risk ): bool {
		return ( is_numeric( $risk['score'] ?? null ) && (float) $risk['score'] >= 65 ) || in_array( (string) ( $risk['risk_level'] ?? '' ), array( 'high', 'elevated' ), true );
	}

	private function customer_name( array $customer ): string {
		$name = sanitize_text_field( trim( (string) ( $customer['full_name'] ?? '' ) ) );
		if ( '' === $name ) {
			$name = sanitize_text_field( trim( (string) ( $customer['first_name'] ?? '' ) . ' ' . (string) ( $customer['last_name'] ?? '' ) ) );
		}
		if ( '' === $name ) {
			$name = sanitize_text_field( (string) ( $customer['email_address'] ?? '' ) );
		}
		return '' !== $name ? $name : sprintf( __( 'Rider #%d', 'avenra-halo-v2' ), (int) $customer['id'] );
	}

	private function mask_phone( string $phone ): string {
		$digits = preg_replace( '/\D+/', '', $phone );
		return strlen( $digits ) >= 4 ? '•••• ' . substr( $digits, -4 ) : '';
	}

	private function initials( string $name ): string {
		$parts = preg_split( '/\s+/', trim( $name ) ) ?: array();
		$first = array_shift( $parts );
		$last = array_pop( $parts );
		$value = (string) ( '' !== (string) $first ? substr( (string) $first, 0, 1 ) : 'A' ) . (string) ( '' !== (string) $last ? substr( (string) $last, 0, 1 ) : '' );
		return strtoupper( sanitize_text_field( $value ) );
	}

	private function age_seconds( mixed $value ): ?int {
		if ( null === $value || '' === trim( (string) $value ) ) {
			return null;
		}
		$time = strtotime( (string) $value . ( preg_match( '/(?:Z|[+-]\d{2}:?\d{2})$/', (string) $value ) ? '' : ' UTC' ) );
		return false === $time ? null : max( 0, time() - $time );
	}

	private function rfc3339( mixed $value ): ?string {
		if ( null === $value || '' === trim( (string) $value ) || str_starts_with( (string) $value, '0000-00-00' ) ) {
			return null;
		}
		$timestamp = strtotime( (string) $value . ( preg_match( '/(?:Z|[+-]\d{2}:?\d{2})$/', (string) $value ) ? '' : ' UTC' ) );
		return false === $timestamp ? null : gmdate( DATE_RFC3339, $timestamp );
	}

	private function nullable_number( mixed $value ): ?float {
		return null === $value || '' === $value || ! is_numeric( $value ) ? null : round( (float) $value, 4 );
	}

	private function bounded_nullable_number( mixed $value, float $min, float $max, int $precision ): ?float {
		if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
			return null;
		}
		$number = (float) $value;
		return is_finite( $number ) && $number >= $min && $number <= $max ? round( $number, $precision ) : null;
	}

	private function number( mixed $value, float $min, float $max, float $default ): float {
		return is_numeric( $value ) ? min( $max, max( $min, (float) $value ) ) : $default;
	}

	private function incident_internal_id( string $public_id ): int {
		global $wpdb;
		if ( ! $this->db->table_exists( $this->db->table( 'incidents' ) ) ) {
			return 0;
		}
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE public_id = %s LIMIT 1', $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	/** @return array{status:string,is_test:bool}|null */
	private function incident_state( string $public_id ): ?array {
		global $wpdb;
		if ( ! $this->db->table_exists( $this->db->table( 'incidents' ) ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT status, is_test FROM `' . esc_sql( $this->db->table( 'incidents' ) ) . '` WHERE public_id = %s LIMIT 1', $public_id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_array( $row ) ? array( 'status' => sanitize_key( (string) $row['status'] ), 'is_test' => '1' === (string) $row['is_test'] ) : null;
	}

	/** @param array<string,mixed> $metadata */
	private function audit( string $event_type, int $incident_id, int $customer_id, array $metadata ): void {
		global $wpdb;
		$table = $this->db->table( 'operations_audit' );
		if ( ! $this->db->table_exists( $table ) ) {
			return;
		}
		$safe = array();
		foreach ( $metadata as $key => $value ) {
			if ( is_scalar( $value ) || null === $value ) {
				$safe[ sanitize_key( (string) $key ) ] = is_string( $value ) ? sanitize_text_field( $value ) : $value;
			}
		}
		$wpdb->insert(
			$table,
			array(
				'wp_user_id'        => get_current_user_id(),
				'event_type'        => sanitize_key( $event_type ),
				'target_customer_id'=> $customer_id > 0 ? $customer_id : null,
				'incident_id'       => $incident_id > 0 ? $incident_id : null,
				'metadata_json'     => $safe ? wp_json_encode( $safe ) : null,
				'created_at'        => current_time( 'mysql', true ),
			)
		);
	}

	/** @param array<string,mixed> $data */
	private function response( array $data ): WP_REST_Response {
		$response = new WP_REST_Response( $data, 200 );
		$response->header( 'Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'X-Robots-Tag', 'noindex, nofollow, noarchive' );
		return $response;
	}
}
