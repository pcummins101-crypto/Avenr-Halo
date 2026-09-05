<?php

defined( 'ABSPATH' ) || exit;

final class Avenra_Halo_V2_REST {
	private const NS = 'avenra-halo/v2';

	private static ?self $instance = null;
	private Avenra_Halo_V2_Database $db;
	private Avenra_Halo_V2_Auth $auth;
	/** @var array<int,array<string,mixed>>|null */
	private ?array $legacy_rides_cache = null;

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

	public function register_routes(): void {
		$this->route( '/bootstrap', 'GET', 'bootstrap', array( $this->auth, 'permission_same_origin' ) );
		$public_auth = array( $this->auth, 'permission_public_auth' );
		$this->route( '/auth/login', 'POST', 'login', $public_auth );
		$this->route( '/auth/register', 'POST', 'register', $public_auth );
		$this->route( '/auth/signup', 'POST', 'register', $public_auth );
		$this->route( '/auth/recover', 'POST', 'recover', $public_auth );
		$this->route( '/auth/recovery', 'POST', 'recover', $public_auth );
		$this->route( '/auth/reset-device', 'POST', 'reset_device_session', $public_auth );
		$this->route( '/auth/logout', 'POST', 'logout' );

		$this->route( '/profile', 'GET', 'get_profile' );
		$this->route( '/profile', array( 'PATCH', 'PUT' ), 'update_profile' );
		$this->route( '/profile/pin', array( 'POST', 'PUT' ), 'update_pin' );
		$this->route( '/safety', 'GET', 'get_safety' );
		$this->route( '/safety', array( 'PATCH', 'PUT' ), 'update_safety' );
		$this->route( '/safety/test-alert', 'POST', 'test_safety_alert' );
		$this->route( '/safety/incident-candidate', 'POST', 'record_incident_candidate' );
		$this->route( '/safety/incidents/(?P<event_id>[A-Za-z0-9._:-]{8,80})', 'GET', 'get_incident_status' );
		$this->route( '/safety/incidents/(?P<event_id>[A-Za-z0-9._:-]{8,80})/cancel', 'POST', 'cancel_incident_candidate' );
		$this->route( '/safety/incidents/(?P<event_id>[A-Za-z0-9._:-]{8,80})/position', 'POST', 'update_incident_position' );
		$this->route( '/safety/crash-alert', 'POST', 'crash_safety_alert' );
		$this->route( '/safety/nok/test', 'POST', 'test_safety_alert' );
		$this->route( '/safety/nok/alert', 'POST', 'crash_safety_alert' );

		$this->route( '/vehicles', 'GET', 'vehicles' );
		$this->route( '/vehicles/latest', 'GET', 'latest_vehicle' );
		$this->route( '/vehicles/claim', 'POST', 'claim_used_vehicle' );
		$this->route( '/vehicles/(?P<id>\d+)/photo', 'GET', 'vehicle_photo' );
		$this->route( '/vehicles/(?P<id>\d+)/photo', 'POST', 'upload_vehicle_photo' );
		$this->route( '/vehicles/(?P<id>\d+)/ride-profiles', 'GET', 'get_ride_profiles' );
		$this->route( '/vehicles/(?P<id>\d+)/ride-profiles', array( 'PATCH', 'PUT' ), 'update_ride_profiles' );

		$this->route( '/rides', 'GET', 'rides' );
		$this->route( '/rides', 'POST', 'save_ride' );
		$this->route( '/rides/(?P<id>[A-Za-z0-9._:-]{1,80})', 'GET', 'ride' );
		$this->route( '/rides/(?P<id>[A-Za-z0-9._:-]{1,80})/share', 'POST', 'share_ride' );
		$this->route( '/rides/(?P<id>[A-Za-z0-9._:-]{8,80})/share-location', 'POST', 'create_live_tracking' );
		$this->route( '/hazards', 'GET', 'hazards' );
		$this->route( '/hazards', 'POST', 'save_hazard' );
		$this->route( '/focus-zones', 'GET', 'focus_zones' );

		$this->route( '/live-tracking', 'GET', 'list_live_tracking' );
		$this->route( '/live-tracking', 'POST', 'create_live_tracking' );
		$this->route( '/live-tracking', 'DELETE', 'end_all_live_tracking' );
		$this->route( '/live-tracking/(?P<token>[A-Za-z0-9_-]{40,90})', 'GET', 'view_live_tracking', '__return_true' );
		$this->route( '/live-tracking/(?P<token>[A-Za-z0-9_-]{40,90})', 'DELETE', 'end_live_tracking' );
		$this->route( '/live-tracking/(?P<token>[A-Za-z0-9_-]{40,90})/position', 'POST', 'update_live_tracking', array( $this->auth, 'permission_live_tracking_update' ) );
		$this->route( '/test-ride-monitoring', 'POST', 'start_test_ride_monitoring' );
		$this->route( '/test-ride-monitoring/(?P<session_id>[a-fA-F0-9-]{36})/position', 'POST', 'update_test_ride_monitoring' );
		$this->route( '/test-ride-monitoring/(?P<session_id>[a-fA-F0-9-]{36})', 'DELETE', 'end_test_ride_monitoring' );

		$this->route( '/documents', 'GET', 'documents' );
		$this->route( '/documents', 'POST', 'upload_document' );
		$this->route( '/documents/(?P<id>[a-fA-F0-9-]{1,36})', 'GET', 'document' );
		$this->route( '/documents/(?P<id>[a-fA-F0-9-]{1,36})/download', 'GET', 'download_document' );
		$this->route( '/documents/(?P<id>[a-fA-F0-9-]{1,36})', 'DELETE', 'archive_document' );

		$this->route( '/shop/catalog', 'GET', 'shop_catalog' );
		$this->route( '/boutique/products', 'GET', 'shop_catalog' );
		$this->route( '/shop/order-handoff', 'POST', 'shop_order_handoff' );
		$this->route( '/cart', 'GET', 'get_cart' );
		$this->route( '/cart', 'POST', 'add_cart_item' );
		$this->route( '/cart/(?P<id>[A-Za-z0-9_-]{8,80})', 'DELETE', 'remove_cart_item' );
		$this->route( '/cart/checkout', 'POST', 'cart_checkout' );
		$this->route( '/manual', 'GET', 'manual' );
		$this->route( '/welcome-pack', 'GET', 'welcome_pack' );
		$this->route( '/routes/plan', 'POST', 'route_plan' );
		$this->route( '/route-plan', 'POST', 'route_plan' ); // V1/V2 migration alias.
	}

	/** @param string|string[] $methods */
	private function route( string $path, string|array $methods, string $callback, string|array $permission = array() ): void {
		if ( empty( $permission ) ) {
			$permission = array( $this->auth, 'permission_authenticated' );
		}
		register_rest_route(
			self::NS,
			$path,
			array(
				'methods'             => $methods,
				'callback'            => array( $this, $callback ),
				'permission_callback' => $permission,
			)
		);
	}

	public function bootstrap( WP_REST_Request $request ): WP_REST_Response {
		$data = array(
			'version'       => AVENRA_HALO_V2_VERSION,
			'authenticated' => false,
			'features'      => $this->features(),
		);

		if ( $this->auth->is_authenticated() ) {
			global $wpdb;

			$customer            = $this->auth->customer();
			$vehicles            = $this->vehicle_rows();
			$vehicle_data        = $vehicles ? $this->serialise_vehicle( $vehicles[0] ) : null;
			$ride_rows           = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'rides' ) ) . '` WHERE customer_id = %d ORDER BY started_at DESC, id DESC LIMIT 25', $this->auth->customer_id() ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$document_rows       = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->db->table( 'documents' ) ) . "` WHERE customer_id = %d AND status = 'active' ORDER BY created_at DESC, id DESC", $this->auth->customer_id() ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$lifecycle           = $this->vehicle_lifecycle( $vehicle_data );
			$csrf = $this->auth->refresh_csrf_if_missing();
			if ( ! $csrf ) {
				return Avenra_Halo_V2_Response::error( 'csrf_cookie_failed', __( 'Halo could not confirm its secure browser cookie. Reset this device session and sign in again.', 'avenra-halo-v2' ), 503, array( 'reset_required' => true, 'retryable' => true ) );
			}
			$data['authenticated'] = true;
			$data['csrf']          = $csrf;
			$data['customer']      = $this->auth->public_customer( $customer );
			$data['safety']        = $this->safety_data( $customer );
			$data['emergency_incident'] = Avenra_Halo_V2_Emergency::instance()->get_latest_unresolved_status( (int) $this->auth->customer_id() );
			$data['vehicles']      = array_map( array( $this, 'serialise_vehicle' ), $vehicles );
			$data['latest_vehicle'] = $vehicle_data;
			$data['vehicle']       = $vehicle_data;
			$data['lifecycle']     = $lifecycle;
			$data['build']         = $vehicle_data['build'] ?? null;
			$activity_rides        = array_merge( array_map( array( $this, 'serialise_ride' ), $ride_rows ), $this->legacy_rides() );
			usort( $activity_rides, static fn( array $left, array $right ): int => strtotime( (string) ( $right['started_at'] ?? '' ) ) <=> strtotime( (string) ( $left['started_at'] ?? '' ) ) );
			$activity_rides        = array_slice( $activity_rides, 0, 25 );
			$data['ride_summary']  = $this->ride_summary();
			$data['activity']      = array( 'summary' => $data['ride_summary'], 'rides' => $activity_rides );
			$data['rides']         = $data['activity']['rides'];
			$data['documents']     = array_map( array( $this, 'serialise_document' ), $document_rows );
			$data['glovebox']      = array( 'documents' => $data['documents'] );
			$data['manual']        = $this->manual_payload();
			$data['cart']          = $this->cart_state();
			$data['limits']        = array( 'document_mb' => (int) ( apply_filters( 'avenra_halo_v2_document_max_bytes', 10 * MB_IN_BYTES ) / MB_IN_BYTES ) );
			$data['support']       = array( 'email' => (string) apply_filters( 'avenra_halo_v2_support_email', 'info@rideavenra.com' ), 'phone' => (string) apply_filters( 'avenra_halo_v2_support_phone', '' ) );
			$data['links']         = (array) apply_filters(
				'avenra_halo_v2_links',
				array(
					'support'        => 'mailto:info@rideavenra.com',
					'book_service'   => add_query_arg( 'type', 'mobile', home_url( '/service/' ) ),
					'dealer_locator' => add_query_arg( 'type', 'dealer', home_url( '/service/' ) ),
					'test_ride'      => 'https://rideavenra.com/Test-Ride',
					'configurator'   => home_url( '/configurator/' ),
				),
				$customer,
				$vehicle_data
			);
			$data['alerts']        = (array) apply_filters( 'avenra_halo_v2_alerts', array(), $customer, $vehicle_data );
			$data['endpoints']     = array(
				'vehicle_photo'      => $vehicle_data ? '/vehicles/' . (int) $vehicle_data['id'] . '/photo' : null,
				'live_location_share'=> '/live-tracking',
				'guardian_recovery'  => '/live-tracking/{viewer}/recovery-request',
			);
		}

		return Avenra_Halo_V2_Response::success( $data );
	}

	public function login( WP_REST_Request $request ): WP_REST_Response {
		$body = $this->body( $request );
		return $this->auth->authenticate_pin( (string) ( $body['email'] ?? '' ), (string) ( $body['pin'] ?? '' ) );
	}

	public function logout( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$customer_id = $this->auth->customer_id();
		$session = $this->auth->session();
		$session_id = is_object( $session ) ? (int) $session->id : 0;
		$account_lock = $this->db->acquire_advisory_lock( 'auth-session', (string) $customer_id, 2 );
		if ( ! $account_lock ) {
			return Avenra_Halo_V2_Response::error( 'logout_busy', __( 'Halo is still securing your live-sharing links. Please try signing out again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		$tracking_lock = null;
		try {
			$tracking_lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) $customer_id, 2 );
			if ( ! $tracking_lock ) {
				return Avenra_Halo_V2_Response::error( 'logout_busy', __( 'Halo is still securing your live-sharing links. Please try signing out again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
			}
			if ( ! $this->auth->current_session_is_active() ) {
				return Avenra_Halo_V2_Response::error( 'logout_session_changed', __( 'This device session already changed. Halo did not clear the newer session.', 'avenra-halo-v2' ), 409, array( 'retryable' => false ) );
			}
			$ended = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE customer_id = %d AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					$customer_id,
					current_time( 'mysql', true )
				)
			);
			if ( false === $ended ) {
				return Avenra_Halo_V2_Response::error( 'logout_privacy_failed', __( 'Halo could not end your live-sharing links, so you have not been signed out. Please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			if ( ! $this->auth->logout() ) {
				return Avenra_Halo_V2_Response::error( 'logout_session_failed', __( 'Halo could not revoke your secure session, so you have not been signed out. Please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			Avenra_Halo_V2_Presence::instance()->mark_session_offline( $session_id );
		} finally {
			if ( $tracking_lock ) {
				$this->db->release_advisory_lock( $tracking_lock );
			}
			$this->db->release_advisory_lock( $account_lock );
		}

		return Avenra_Halo_V2_Response::success( array( 'authenticated' => false, 'live_tracking_ended' => (int) $ended ) );
	}

	/** Explicit recovery for an HttpOnly cookie whose server session is stale. */
	public function reset_device_session( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$session           = $this->auth->session();
		$presented_session = $session ?: $this->auth->presented_session_record();
		if ( is_wp_error( $presented_session ) ) {
			return Avenra_Halo_V2_Response::error( 'device_reset_lookup_failed', __( 'Halo could not safely verify this device session. Nothing was reset; please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( ! $presented_session ) {
			$this->auth->clear_device_session();
			return Avenra_Halo_V2_Response::success( array( 'reset' => true, 'authenticated' => false, 'live_tracking_ended' => 0 ) );
		}
		if ( ! $session && ! empty( $presented_session->revoked_at ) ) {
			// A revoked bearer has no authority to mutate account data. Clearing the
			// local cookie is the only permitted operation on a replay.
			$this->auth->clear_device_session();
			Avenra_Halo_V2_Presence::instance()->mark_session_offline( (int) $presented_session->id );
			return Avenra_Halo_V2_Response::success( array( 'reset' => true, 'authenticated' => false, 'live_tracking_ended' => 0 ) );
		}
		$presented_is_active = strtotime( (string) $presented_session->expires_at . ' UTC' ) > time();
		$obsolete_revision   = ! $session && $presented_is_active && ! $this->auth->session_record_has_current_auth_revision( $presented_session );
		if ( ! $session && $presented_is_active && ! $obsolete_revision ) {
			// The session row is active but its customer could not be resolved. This
			// may be a transient source-table failure, so do not revoke or clear it.
			return Avenra_Halo_V2_Response::error( 'device_reset_account_unavailable', __( 'Halo could not safely resolve this account. Nothing was reset; please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}

		$customer_id = (int) $presented_session->customer_id;
		$account_lock = $this->db->acquire_advisory_lock( 'auth-session', (string) $customer_id, 2 );
		if ( ! $account_lock ) {
			return Avenra_Halo_V2_Response::error( 'device_reset_busy', __( 'Halo is still securing this device session. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		$claimed_at   = null;
		$tracking_lock = null;
		try {
			$tracking_lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) $customer_id, 2 );
			if ( ! $tracking_lock ) {
				return Avenra_Halo_V2_Response::error( 'device_reset_busy', __( 'Halo is still securing this device session. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
			}
			if ( ! $session ) {
				$claimed_at = current_time( 'mysql', true );
				if ( $obsolete_revision ) {
					$claimed = $wpdb->query(
						$wpdb->prepare(
							'UPDATE `' . esc_sql( $this->db->table( 'sessions' ) ) . '` SET revoked_at = %s WHERE id = %d AND token_hash = %s AND revoked_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
							$claimed_at,
							(int) $presented_session->id,
							(string) $presented_session->token_hash,
							current_time( 'mysql', true )
						)
					);
				} else {
					$claimed = $wpdb->query(
						$wpdb->prepare(
							'UPDATE `' . esc_sql( $this->db->table( 'sessions' ) ) . '` SET revoked_at = %s WHERE id = %d AND token_hash = %s AND revoked_at IS NULL AND expires_at <= %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
							$claimed_at,
							(int) $presented_session->id,
							(string) $presented_session->token_hash,
							current_time( 'mysql', true )
						)
					);
				}
				if ( false === $claimed ) {
					return Avenra_Halo_V2_Response::error( 'device_reset_session_failed', __( 'Halo could not safely claim this older device session. Nothing was reset; please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
				}
				if ( 1 !== (int) $claimed ) {
					// Another request already consumed the one-shot recovery. It may clear
					// this browser, but must not terminate any newer account activity.
					$this->auth->clear_device_session();
					Avenra_Halo_V2_Presence::instance()->mark_session_offline( (int) $presented_session->id );
					return Avenra_Halo_V2_Response::success( array( 'reset' => true, 'authenticated' => false, 'live_tracking_ended' => 0 ) );
				}
			}

			$ended = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE customer_id = %d AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					$customer_id,
					current_time( 'mysql', true )
				)
			);
			if ( false === $ended ) {
				if ( $claimed_at ) {
					$rolled_back = $wpdb->query(
						$wpdb->prepare(
							'UPDATE `' . esc_sql( $this->db->table( 'sessions' ) ) . '` SET revoked_at = NULL WHERE id = %d AND token_hash = %s AND revoked_at = %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
							(int) $presented_session->id,
							(string) $presented_session->token_hash,
							$claimed_at
						)
					);
					if ( 1 !== (int) $rolled_back ) {
						do_action( 'avenra_halo_v2_device_reset_rollback_error', (int) $presented_session->id, Avenra_Halo_V2_Response::request_id() );
					}
				}
				return Avenra_Halo_V2_Response::error( 'device_reset_privacy_failed', __( 'Halo could not end this account\'s live-sharing links, so the device session was not reset.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			if ( $session && ! $this->auth->logout() ) {
				return Avenra_Halo_V2_Response::error( 'device_reset_session_failed', __( 'Halo could not revoke this device session. Please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			if ( ! $session ) {
				$this->auth->clear_device_session();
			}
			Avenra_Halo_V2_Presence::instance()->mark_session_offline( (int) $presented_session->id );
		} finally {
			if ( $tracking_lock ) {
				$this->db->release_advisory_lock( $tracking_lock );
			}
			$this->db->release_advisory_lock( $account_lock );
		}

		return Avenra_Halo_V2_Response::success( array( 'reset' => true, 'authenticated' => false, 'live_tracking_ended' => (int) $ended ) );
	}

	public function register( WP_REST_Request $request ): WP_REST_Response {
		$account_created = false;
		$sensitive_values = array();
		try {
			$sensitive_values = $this->registration_sensitive_values( $this->body( $request ) );
		} catch ( Throwable $ignored ) {
			// The final boundary must remain safe even when request parsing itself is
			// the failing integration. Never parse the submitted body again in catch.
		}

		try {
			return $this->register_account( $request, $account_created );
		} catch ( Throwable $error ) {
			$this->log_registration_throwable( 'unhandled', $error, $sensitive_values );

			$message = $account_created
				? __( 'Your account was created, but Halo could not complete setup. Please sign in or contact Avenrà support if the problem continues.', 'avenra-halo-v2' )
				: __( 'Halo could not complete registration safely. Please try again or contact Avenrà support.', 'avenra-halo-v2' );

			return Avenra_Halo_V2_Response::error(
				'registration_service_error',
				$message,
				503,
				array(
					'retryable'       => true,
					'account_created' => $account_created,
				)
			);
		}
	}

	private function register_account( WP_REST_Request $request, bool &$account_created ): WP_REST_Response {
		global $wpdb;

		if ( ! $this->db->source_tables_ready() ) {
			return Avenra_Halo_V2_Response::error( 'account_service_unavailable', __( 'Halo registration is temporarily unavailable.', 'avenra-halo-v2' ), 503 );
		}

		$body      = $this->body( $request );
		$email     = strtolower( trim( sanitize_email( (string) ( $body['email'] ?? '' ) ) ) );
		$pin       = preg_replace( '/\D/', '', (string) ( $body['pin'] ?? '' ) );
		$confirm_pin = preg_replace( '/\D/', '', (string) ( $body['confirm_pin'] ?? $body['pin_confirmation'] ?? $body['pin'] ?? '' ) );
		$full_name = sanitize_text_field( (string) ( $body['full_name'] ?? $body['name'] ?? '' ) );
		$mobile    = sanitize_text_field( (string) ( $body['mobile'] ?? $body['mobile_number'] ?? '' ) );
		$postcode  = sanitize_text_field( (string) ( $body['postcode'] ?? '' ) );
		$address   = sanitize_textarea_field( (string) ( $body['address'] ?? $body['full_address'] ?? '' ) );
		if ( ! is_email( $email ) || ! preg_match( '/^\d{6}$/', $pin ) || $pin !== $confirm_pin || $this->text_length( $full_name ) < 2 ) {
			return Avenra_Halo_V2_Response::error( 'invalid_registration', __( 'Enter your name, a valid email address and a six-digit PIN.', 'avenra-halo-v2' ), 422 );
		}
		if ( strlen( preg_replace( '/\D/', '', $mobile ) ) < 7 || $this->text_length( $postcode ) < 2 || $this->text_length( $postcode ) > 12 ) {
			return Avenra_Halo_V2_Response::error( 'invalid_contact_details', __( 'Enter a valid mobile number and postcode.', 'avenra-halo-v2' ), 422 );
		}
		$address_required = (bool) apply_filters( 'avenra_halo_v2_registration_address_required', true, $body );
		if ( ( $address_required && $this->text_length( trim( $address ) ) < 5 ) || $this->text_length( $address ) > 1000 ) {
			return Avenra_Halo_V2_Response::error( 'invalid_address', __( 'Enter your full postal address.', 'avenra-halo-v2' ), 422 );
		}
		if ( ! $this->boolean( $body['terms'] ?? false ) ) {
			return Avenra_Halo_V2_Response::error( 'terms_required', __( 'Please agree to the Halo terms and acknowledge the privacy notice to create an account.', 'avenra-halo-v2' ), 422 );
		}
		$dob = $this->valid_date( (string) ( $body['date_of_birth'] ?? $body['dob'] ?? '' ) );
		$minimum_age = min( 100, max( 0, (int) apply_filters( 'avenra_halo_v2_minimum_account_age', 16 ) ) );
		$oldest_date = gmdate( 'Y-m-d', strtotime( '-120 years' ) );
		$latest_date = gmdate( 'Y-m-d', strtotime( '-' . $minimum_age . ' years' ) );
		if ( ! $dob || $dob < $oldest_date || $dob > $latest_date ) {
			return Avenra_Halo_V2_Response::error( 'invalid_date_of_birth', sprintf( __( 'Enter a valid date of birth. Halo accounts are available from age %d.', 'avenra-halo-v2' ), $minimum_age ), 422 );
		}
		if ( ! $this->consume_rate_limit( 'register-lookup-ip', $this->request_ip(), 30, HOUR_IN_SECONDS ) || ! $this->consume_rate_limit( 'register-lookup-account', $email, 8, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'registration_throttled', __( 'Too many account requests were received. Please wait and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		if ( $this->db->customer_by_email( $email ) ) {
			return Avenra_Halo_V2_Response::error( 'account_exists', __( 'An account with that email already exists. Please sign in or recover your PIN.', 'avenra-halo-v2' ), 409 );
		}

		try {
			$verification = has_filter( 'avenra_halo_v2_registration_verification' )
				? apply_filters( 'avenra_halo_v2_registration_verification', false, $email, $body, $request )
				: false;
			if ( is_wp_error( $verification ) ) {
				$error_data = $verification->get_error_data();
				$status = is_array( $error_data ) ? (int) ( $error_data['status'] ?? 422 ) : 422;
				$status = $status >= 400 && $status <= 599 ? $status : 422;
				return Avenra_Halo_V2_Response::error( 'email_verification_required', $verification->get_error_message() ?: __( 'Verify your email address before creating the account.', 'avenra-halo-v2' ), $status );
			}
			$verified = true === $verification || ( is_array( $verification ) && true === ( $verification['verified'] ?? false ) );
			if ( ! $verified ) {
				$verification_code = preg_replace( '/\D/', '', (string) ( $body['verification_code'] ?? $body['email_code'] ?? '' ) );
				if ( '' === $verification_code ) {
					if ( ! $this->consume_rate_limit( 'register-code-account', $email, 3, HOUR_IN_SECONDS ) || ! $this->consume_rate_limit( 'register-code-ip', $this->request_ip(), 12, HOUR_IN_SECONDS ) ) {
						return Avenra_Halo_V2_Response::error( 'registration_throttled', __( 'Too many verification codes were requested. Please wait and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
					}
					$code     = str_pad( (string) random_int( 0, 999999 ), 6, '0', STR_PAD_LEFT );
					$lifetime = min( 30 * MINUTE_IN_SECONDS, max( 5 * MINUTE_IN_SECONDS, (int) apply_filters( 'avenra_halo_v2_registration_code_lifetime', 10 * MINUTE_IN_SECONDS ) ) );
					if ( ! $this->db->store_one_time_secret( 'registration-email', $email, wp_hash_password( $code ), $lifetime ) ) {
						return Avenra_Halo_V2_Response::error( 'registration_verification_unavailable', __( 'Halo could not start secure email verification. Please try again.', 'avenra-halo-v2' ), 503 );
					}

					$delivery = apply_filters( 'avenra_halo_v2_registration_code_delivery', null, $email, $code, $lifetime, Avenra_Halo_V2_Response::request_id() );
					if ( null === $delivery ) {
						$subject = __( 'Your Avenrà Halo verification code', 'avenra-halo-v2' );
						$message = sprintf( __( "Your Avenrà Halo verification code is %1$s. It expires in %2$d minutes. If you did not request this, you can ignore this email.", 'avenra-halo-v2' ), $code, (int) ceil( $lifetime / MINUTE_IN_SECONDS ) );
						$delivered = wp_mail( $email, $subject, $message, array( 'Content-Type: text/plain; charset=UTF-8' ) );
					} else {
						$delivered = true === $delivery || ( is_array( $delivery ) && ! empty( $delivery['sent'] ?? $delivery['success'] ?? false ) );
					}
					if ( ! $delivered ) {
						$this->db->clear_one_time_secret( 'registration-email', $email );
						do_action( 'avenra_halo_v2_registration_code_error', is_wp_error( $delivery ) ? $delivery : null, Avenra_Halo_V2_Response::request_id() );
						return Avenra_Halo_V2_Response::error( 'registration_verification_unavailable', __( 'The verification email could not be sent. Please try again or contact Avenrà support.', 'avenra-halo-v2' ), 503 );
					}

					return Avenra_Halo_V2_Response::success(
						array(
							'verification_required' => true,
							'channel'               => 'email',
							'expires_in'            => $lifetime,
							'message'               => __( 'Enter the six-digit verification code sent to your email address.', 'avenra-halo-v2' ),
						),
						202
					);
				}

				if ( ! preg_match( '/^\d{6}$/', $verification_code ) || ! $this->consume_rate_limit( 'register-verify-account', $email, 6, 15 * MINUTE_IN_SECONDS ) || ! $this->consume_rate_limit( 'register-verify-ip', $this->request_ip(), 30, 15 * MINUTE_IN_SECONDS ) ) {
					return Avenra_Halo_V2_Response::error( 'email_verification_failed', __( 'The verification code was invalid or too many attempts were made.', 'avenra-halo-v2' ), 422 );
				}
				if ( ! $this->db->consume_one_time_secret( 'registration-email', $email, $verification_code ) ) {
					return Avenra_Halo_V2_Response::error( 'email_verification_failed', __( 'The verification code was invalid or expired.', 'avenra-halo-v2' ), 422 );
				}
				$verified = true;
			}
		} catch ( Throwable $error ) {
			$this->clear_registration_secret_safely( $email, $body );
			$this->log_registration_throwable( 'verification', $error, $this->registration_sensitive_values( $body ) );
			return Avenra_Halo_V2_Response::error( 'registration_verification_unavailable', __( 'Halo could not complete secure email verification. Please try again or contact Avenrà support.', 'avenra-halo-v2' ), 503, array( 'retryable' => true, 'account_created' => false ) );
		}
		if ( ! $this->consume_rate_limit( 'register-create-ip', $this->request_ip(), 8, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'registration_throttled', __( 'Too many accounts were created from this connection. Please wait and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}

		if ( $this->db->customer_by_email( $email ) ) {
			return Avenra_Halo_V2_Response::error( 'account_exists', __( 'An account with that verified email already exists. Please sign in.', 'avenra-halo-v2' ), 409 );
		}
		$table = $this->db->table( 'customers' );
		$now   = current_time( 'mysql', true );
		$notice_version = sanitize_text_field( (string) apply_filters( 'avenra_halo_v2_privacy_notice_version', get_option( 'avenra_halo_privacy_notice_version', AVENRA_HALO_V2_VERSION ) ) );
		$pin_data = $this->auth->pin_storage_data( $table, $pin );
		if ( ! $pin_data ) {
			return Avenra_Halo_V2_Response::error( 'pin_storage_unavailable', __( 'This account database cannot store a Halo PIN safely. Please contact Avenrà support.', 'avenra-halo-v2' ), 503 );
		}
		$data  = array_merge( $this->db->supported_data(
			$table,
			array(
				'full_name'                  => $full_name,
				'email_address'              => $email,
				'email_normalized'           => $email,
				'mobile_number'              => $mobile,
				'postcode'                   => $postcode,
				'full_address'               => $address,
				'date_of_birth'              => $dob,
				'has_ccj'                    => 'No',
				'has_iva'                    => 'No',
				'access_pin_failed_attempts' => 0,
				'access_pin_locked_until'    => null,
				'identity_status'            => 'self_registered',
				'signup_source'              => 'Halo V2' . ( empty( $body['current_bike'] ) ? '' : ' | Rides: ' . sanitize_text_field( (string) $body['current_bike'] ) ),
				'terms_acknowledged_at'      => $now,
				'privacy_acknowledged_at'    => $now,
				'terms_version'              => $notice_version,
				'privacy_notice_version'     => $notice_version,
				'updated_at'                 => $now,
			)
		), $pin_data );

		if ( ! $wpdb->insert( $table, $data ) ) {
			do_action( 'avenra_halo_v2_registration_error', $wpdb->last_error, Avenra_Halo_V2_Response::request_id() );
			return Avenra_Halo_V2_Response::error( 'registration_failed', __( 'We could not create the account. Please try again or contact Avenrà support.', 'avenra-halo-v2' ), 500 );
		}
		$account_created = true;

		$customer_id = (int) $wpdb->insert_id;
		$customer    = $this->db->customer_by_id( $customer_id );
		$issued      = $this->auth->issue_session( $customer_id, $customer );
		$sensitive_values = $this->registration_sensitive_values( $body );
		$this->run_registration_action_safely( 'avenra_halo_v2_customer_registered', array( $customer_id ), $sensitive_values );
		$this->run_registration_action_safely( 'avenra_halo_v2_terms_acknowledged', array( $customer_id, $notice_version, $now ), $sensitive_values );
		if ( is_wp_error( $issued ) ) {
			if ( 'stale_browser_session' === $issued->get_error_code() ) {
				return Avenra_Halo_V2_Response::error( 'stale_browser_session', __( 'Your account was created, but this browser has an older Halo session. Reset this device session, then sign in.', 'avenra-halo-v2' ), 409, array( 'account_created' => true, 'reset_required' => true ) );
			}
			if ( 'session_cookie_failed' === $issued->get_error_code() ) {
				return Avenra_Halo_V2_Response::error( 'session_cookie_failed', __( 'Your account was created, but Halo could not save the secure session in this browser. Reset this device session, then sign in.', 'avenra-halo-v2' ), 503, array( 'account_created' => true, 'reset_required' => true, 'retryable' => true ) );
			}
			return Avenra_Halo_V2_Response::error( 'session_service_unavailable', __( 'Your account was created, but Halo could not sign you in. Reset this device session, then sign in.', 'avenra-halo-v2' ), 503, array( 'account_created' => true, 'reset_required' => true, 'retryable' => true ) );
		}
		$customer = $this->auth->customer();
		if ( ! $customer ) {
			return Avenra_Halo_V2_Response::error( 'session_service_unavailable', __( 'Your account was created, but Halo could not confirm your profile. Please sign in again.', 'avenra-halo-v2' ), 503, array( 'account_created' => true ) );
		}

		return Avenra_Halo_V2_Response::success(
			array(
				'authenticated' => true,
				'customer'      => $this->auth->public_customer( $customer ),
				'csrf'          => $issued['csrf'],
				'expires_at'    => $issued['expires_at'],
			),
			201
		);
	}

	/** Best-effort cleanup after a verification provider or mail transport throws. */
	private function clear_registration_secret_safely( string $email, array $body ): void {
		try {
			$this->db->clear_one_time_secret( 'registration-email', $email );
		} catch ( Throwable $error ) {
			$this->log_registration_throwable( 'verification_cleanup', $error, $this->registration_sensitive_values( $body ) );
		}
	}

	/**
	 * Registration integration actions are notifications, not part of the commit.
	 * Discard accidental output and contain extension failures so a created account
	 * still receives Halo's structured REST response.
	 *
	 * @param array<int,mixed> $args
	 * @param string[]         $sensitive_values
	 */
	private function run_registration_action_safely( string $hook, array $args, array $sensitive_values ): void {
		$buffer_level   = ob_get_level();
		$buffer_started = ob_start();

		try {
			do_action_ref_array( $hook, $args );
		} catch ( Throwable $error ) {
			$this->log_registration_throwable( sanitize_key( $hook ), $error, $sensitive_values );
		} finally {
			if ( $buffer_started ) {
				while ( ob_get_level() > $buffer_level ) {
					ob_end_clean();
				}
			}
		}
	}

	/** @return string[] */
	private function registration_sensitive_values( array $body ): array {
		$values = array();
		array_walk_recursive(
			$body,
			static function ( mixed $value ) use ( &$values ): void {
				if ( ! is_scalar( $value ) ) {
					return;
				}
				$value = trim( (string) $value );
				if ( strlen( $value ) >= 2 ) {
					$values[] = $value;
				}
			}
		);
		$values = array_values( array_unique( $values ) );
		usort( $values, static fn( string $left, string $right ): int => strlen( $right ) <=> strlen( $left ) );
		return $values;
	}

	/** Log an exception without request payloads, stack traces or submitted PII. */
	private function log_registration_throwable( string $stage, Throwable $error, array $sensitive_values ): void {
		$message = sanitize_text_field( wp_strip_all_tags( (string) $error->getMessage() ) );
		if ( $sensitive_values ) {
			$message = str_ireplace( $sensitive_values, '[redacted]', $message );
		}
		$message = (string) preg_replace( '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i', '[redacted-email]', $message );
		$message = (string) preg_replace( '/(?<!\d)\d{6}(?!\d)/', '[redacted-code]', $message );
		$message = (string) preg_replace( '/\+?\d[\d ().\-]{6,}\d/', '[redacted-number]', $message );
		$message = $this->text_substr( trim( $message ), 0, 240 );
		if ( '' === $message ) {
			$message = 'No safe exception message was supplied.';
		}
		$class = (string) preg_replace( '/[^A-Za-z0-9_\\\\]/', '', get_class( $error ) );
		if ( '' === $class ) {
			$class = 'Throwable';
		}

		error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- server-side operational diagnostic without submitted data.
			sprintf(
				'[Avenra Halo V2] request_id=%1$s registration_stage=%2$s exception=%3$s message=%4$s',
				Avenra_Halo_V2_Response::request_id(),
				sanitize_key( $stage ),
				$class,
				$message
			)
		);
	}

	public function recover( WP_REST_Request $request ): WP_REST_Response {
		$body  = $this->body( $request );
		$email = strtolower( trim( sanitize_email( (string) ( $body['email'] ?? '' ) ) ) );
		if ( ! is_email( $email ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_email', __( 'Enter a valid email address.', 'avenra-halo-v2' ), 422 );
		}
		$provider_configured = has_filter( 'avenra_halo_v2_recovery_request' ) || has_action( 'wp_ajax_nopriv_reset_avenra_pin' ) || has_action( 'wp_ajax_reset_avenra_pin' );
		if ( ! $provider_configured ) {
			return Avenra_Halo_V2_Response::error( 'recovery_service_unavailable', __( 'PIN recovery is temporarily unavailable. Please contact Avenrà support.', 'avenra-halo-v2' ), 503 );
		}

		$account_allowed = $this->consume_rate_limit( 'recover-account', $email, 4, HOUR_IN_SECONDS );
		$ip_allowed      = $this->consume_rate_limit( 'recover-ip', $this->request_ip(), 20, HOUR_IN_SECONDS );
		if ( $account_allowed && $ip_allowed ) {
			$customer = $this->db->customer_by_email( $email );
			if ( $customer ) {
				$handled = (bool) apply_filters( 'avenra_halo_v2_recovery_request', false, $customer, Avenra_Halo_V2_Response::request_id() );
				if ( ! $handled ) {
					$legacy  = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch( 'reset_avenra_pin', array( 'email' => $email ), 0 );
					$handled = ! is_wp_error( $legacy ) && ( ! empty( $legacy['success'] ) || 'ok' === strtolower( (string) ( $legacy['status'] ?? '' ) ) );
					if ( is_wp_error( $legacy ) ) {
						do_action( 'avenra_halo_v2_recovery_error', $legacy, (int) $customer->id, Avenra_Halo_V2_Response::request_id() );
					}
				}
				do_action( 'avenra_halo_v2_recovery_requested', (int) $customer->id, $handled );
			}
		}

		// Deliberately identical for known and unknown addresses.
		return Avenra_Halo_V2_Response::success( array( 'message' => __( 'If that email matches a Halo account, recovery instructions will be sent shortly.', 'avenra-halo-v2' ) ) );
	}

	public function get_profile( WP_REST_Request $request ): WP_REST_Response {
		return Avenra_Halo_V2_Response::success( $this->auth->public_customer( $this->auth->customer() ) );
	}

	public function update_profile( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body     = $this->body( $request );
		$customer = $this->auth->customer();
		$table    = $this->db->table( 'customers' );
		$data     = array();
		if ( array_key_exists( 'full_name', $body ) ) {
			$data['full_name'] = sanitize_text_field( (string) $body['full_name'] );
		}
		if ( array_key_exists( 'email', $body ) || array_key_exists( 'email_address', $body ) ) {
			$email = strtolower( trim( sanitize_email( (string) ( $body['email'] ?? $body['email_address'] ) ) ) );
			if ( ! is_email( $email ) ) {
				return Avenra_Halo_V2_Response::error( 'invalid_email', __( 'Enter a valid email address.', 'avenra-halo-v2' ), 422 );
			}
			$current_email = strtolower( trim( sanitize_email( (string) ( $customer->email_address ?? '' ) ) ) );
			if ( ! hash_equals( $current_email, $email ) ) {
				return Avenra_Halo_V2_Response::error( 'verified_email_change_required', __( 'For your security, email changes require Avenrà support to verify the new address.', 'avenra-halo-v2' ), 409 );
			}
		}
		if ( array_key_exists( 'mobile', $body ) || array_key_exists( 'mobile_number', $body ) ) {
			$mobile = sanitize_text_field( (string) ( $body['mobile'] ?? $body['mobile_number'] ) );
			if ( Avenra_Halo_V2_Emergency::instance()->assist_consent( (int) $customer->id ) && strlen( (string) preg_replace( '/\D+/', '', $mobile ) ) < 7 ) {
				return Avenra_Halo_V2_Response::error( 'emergency_assist_mobile_required', __( 'Keep a valid rider mobile number on your profile while Emergency Assist is enabled.', 'avenra-halo-v2' ), 422 );
			}
			$data['mobile_number'] = $mobile;
		}
		if ( array_key_exists( 'address', $body ) || array_key_exists( 'full_address', $body ) ) {
			$data['full_address'] = sanitize_textarea_field( (string) ( $body['address'] ?? $body['full_address'] ) );
		}
		if ( array_key_exists( 'postcode', $body ) ) {
			$data['postcode'] = sanitize_text_field( (string) $body['postcode'] );
		}
		$data['updated_at'] = current_time( 'mysql', true );
		$data = $this->db->supported_data( $table, $data );

		if ( $data && false === $wpdb->update( $table, $data, array( 'id' => (int) $customer->id ) ) ) {
			return Avenra_Halo_V2_Response::error( 'profile_update_failed', __( 'Your profile could not be saved.', 'avenra-halo-v2' ), 500 );
		}

		$updated_customer = $this->db->customer_by_id( (int) $customer->id );
		if ( ! $updated_customer ) {
			return Avenra_Halo_V2_Response::error( 'profile_refresh_failed', __( 'Your profile was saved, but Halo could not refresh it. Please reload.', 'avenra-halo-v2' ), 503 );
		}
		return Avenra_Halo_V2_Response::success( $this->auth->public_customer( $updated_customer ) );
	}

	public function update_pin( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body    = $this->body( $request );
		$current = preg_replace( '/\D/', '', (string) ( $body['current_pin'] ?? '' ) );
		$new     = preg_replace( '/\D/', '', (string) ( $body['new_pin'] ?? '' ) );
		$customer = $this->auth->customer();

		if ( ! preg_match( '/^\d{6}$/', $current ) || ! preg_match( '/^\d{6}$/', $new ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_pin', __( 'Both PINs must contain exactly six digits.', 'avenra-halo-v2' ), 422 );
		}
		$pin_scope = (string) (int) $customer->id;
		if ( ! $this->consume_rate_limit( 'pin-change-account', $pin_scope, 5, 15 * MINUTE_IN_SECONDS ) || ! $this->consume_rate_limit( 'pin-change-ip', $this->request_ip(), 20, 15 * MINUTE_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'pin_change_throttled', __( 'Too many PIN checks were made. Please wait 15 minutes and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 900 ) );
		}
		if ( ! $this->auth->verify_customer_pin( $customer, $current ) ) {
			return Avenra_Halo_V2_Response::error( 'current_pin_incorrect', __( 'Your current PIN was not correct.', 'avenra-halo-v2' ), 403 );
		}
		$this->db->clear_rate_limit( 'pin-change-account', $pin_scope );

		$table = $this->db->table( 'customers' );
		$pin_data = $this->auth->pin_storage_data( $table, $new );
		if ( ! $pin_data ) {
			return Avenra_Halo_V2_Response::error( 'pin_storage_unavailable', __( 'This account database cannot store a Halo PIN. Please contact Avenrà support.', 'avenra-halo-v2' ), 503 );
		}
		$data  = array_merge( $this->db->supported_data(
			$table,
			array(
				'updated_at'             => current_time( 'mysql', true ),
			)
		), $pin_data );
		$current_session = $this->auth->session();
		if ( ! $current_session ) {
			return Avenra_Halo_V2_Response::error( 'authentication_required', __( 'Your secure Halo session changed. Sign in and try again.', 'avenra-halo-v2' ), 401 );
		}
		$account_lock = $this->db->acquire_advisory_lock( 'auth-session', (string) (int) $customer->id, 2 );
		if ( ! $account_lock ) {
			return Avenra_Halo_V2_Response::error( 'pin_update_busy', __( 'Halo is still securing this account. Please try changing your PIN again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		$tracking_lock = null;
		try {
			$locked_customer = $this->db->customer_by_id( (int) $customer->id );
			if ( ! $locked_customer ) {
				return Avenra_Halo_V2_Response::error( 'account_service_unavailable', __( 'Halo could not safely verify this account. Your PIN was not changed.', 'avenra-halo-v2' ), 503 );
			}
			if ( ! $this->auth->verify_customer_pin( $locked_customer, $current ) ) {
				return Avenra_Halo_V2_Response::error( 'credentials_changed', __( 'Your Halo PIN changed while this request was being checked. Enter the current PIN and try again.', 'avenra-halo-v2' ), 409 );
			}
			$tracking_lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) (int) $customer->id, 2 );
			if ( ! $tracking_lock ) {
				return Avenra_Halo_V2_Response::error( 'pin_update_busy', __( 'Halo is still securing this account. Please try changing your PIN again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
			}
			if ( ! $this->auth->current_session_is_active() ) {
				return Avenra_Halo_V2_Response::error( 'authentication_required', __( 'Your secure Halo session changed. Sign in and try again.', 'avenra-halo-v2' ), 401 );
			}
			$ended = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE customer_id = %d AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					(int) $customer->id,
					current_time( 'mysql', true )
				)
			);
			if ( false === $ended ) {
				return Avenra_Halo_V2_Response::error( 'pin_update_privacy_failed', __( 'Halo could not end live sharing, so your PIN was not changed. Please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$revoked = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'sessions' ) ) . '` SET revoked_at = %s WHERE customer_id = %d AND id <> %d AND revoked_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					(int) $customer->id,
					(int) $current_session->id
				)
			);
			if ( false === $revoked ) {
				return Avenra_Halo_V2_Response::error( 'pin_update_session_failed', __( 'Halo could not close the account\'s older sessions, so your PIN was not changed. Please try again.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			if ( false === $wpdb->update( $table, $data, array( 'id' => (int) $customer->id ) ) ) {
				return Avenra_Halo_V2_Response::error( 'pin_update_failed', __( 'Your PIN could not be updated. Older sessions and live links were closed for safety.', 'avenra-halo-v2' ), 500 );
			}

			return Avenra_Halo_V2_Response::success( array( 'message' => __( 'Your six-digit PIN has been updated. Older sessions and live links were closed.', 'avenra-halo-v2' ), 'live_tracking_ended' => (int) $ended, 'sessions_revoked' => (int) $revoked ) );
		} finally {
			if ( $tracking_lock ) {
				$this->db->release_advisory_lock( $tracking_lock );
			}
			$this->db->release_advisory_lock( $account_lock );
		}
	}

	public function get_safety( WP_REST_Request $request ): WP_REST_Response {
		return Avenra_Halo_V2_Response::success( $this->safety_data( $this->auth->customer() ) );
	}

	public function update_safety( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body             = $this->body( $request );
		$customer         = $this->auth->customer();
		$table            = $this->db->table( 'customers' );
		$data             = array();
		$assist_requested = null;
		$medical_requested = null;
		$test_ride_monitoring_requested = null;
		$supplementary_requested = array();
		if ( is_array( $body['nok'] ?? null ) ) {
			$body['nok_name']     = $body['nok']['name'] ?? $body['nok_name'] ?? '';
			$body['nok_mobile']   = $body['nok']['mobile'] ?? $body['nok']['phone'] ?? $body['nok_mobile'] ?? '';
			$body['nok_relation'] = $body['nok']['relationship'] ?? $body['nok']['relation'] ?? $body['nok_relation'] ?? '';
		}
		if ( is_array( $body['medical'] ?? null ) ) {
			$body['blood_type']    = $body['medical']['blood_group'] ?? $body['medical']['blood_type'] ?? $body['blood_type'] ?? '';
			$body['medical_notes'] = $body['medical']['notes'] ?? $body['medical_notes'] ?? '';
			if ( isset( $body['medical']['date_of_birth'] ) ) {
				$body['date_of_birth'] = $body['medical']['date_of_birth'];
			}
			if ( isset( $body['medical']['weight_kg'] ) ) {
				$body['weight_kg'] = $body['medical']['weight_kg'];
			}
		}
		if ( is_array( $body['consents'] ?? null ) ) {
			if ( array_key_exists( 'nok_alerts', $body['consents'] ) ) {
				$body['halo_nok_consent'] = $body['consents']['nok_alerts'];
			}
			if ( array_key_exists( 'medical_sharing', $body['consents'] ) ) {
				$body['halo_emergency'] = $body['consents']['medical_sharing'];
			}
			if ( array_key_exists( 'emergency_assist_enabled', $body['consents'] ) ) {
				$body['emergency_assist_enabled'] = $body['consents']['emergency_assist_enabled'];
			}
			if ( array_key_exists( 'test_ride_monitoring', $body['consents'] ) ) {
				$test_ride_choice = $body['consents']['test_ride_monitoring'];
				if ( is_array( $test_ride_choice ) ) {
					$body['test_ride_monitoring_armed'] = $test_ride_choice['armed'] ?? false;
					if ( array_key_exists( 'consent_version', $test_ride_choice ) ) {
						$body['test_ride_monitoring_consent_version'] = $test_ride_choice['consent_version'];
					}
					if ( array_key_exists( 'expected_arm_id', $test_ride_choice ) ) {
						$body['test_ride_monitoring_expected_arm_id'] = $test_ride_choice['expected_arm_id'];
					}
					if ( array_key_exists( 'expected_consented_at', $test_ride_choice ) ) {
						$body['test_ride_monitoring_expected_consented_at'] = $test_ride_choice['expected_consented_at'];
					}
				} else {
					$body['test_ride_monitoring_armed'] = $test_ride_choice;
				}
			}
			if ( array_key_exists( 'proxy', $body['consents'] ) ) {
				$body['halo_proxy'] = $body['consents']['proxy'];
			}
			if ( array_key_exists( 'law_enforcement', $body['consents'] ) ) {
				$body['halo_law'] = $body['consents']['law_enforcement'];
			}
			if ( array_key_exists( 'ai_processing', $body['consents'] ) ) {
				$body['halo_ai'] = $body['consents']['ai_processing'];
			}
		}
		if ( array_key_exists( 'emergency_assist_enabled', $body ) || array_key_exists( 'halo_emergency_assist', $body ) ) {
			$assist_requested = $this->boolean( $body['emergency_assist_enabled'] ?? $body['halo_emergency_assist'] );
		}
		if ( array_key_exists( 'halo_emergency', $body ) ) {
			$medical_requested = $this->boolean( $body['halo_emergency'] );
		}
		if ( array_key_exists( 'test_ride_monitoring_armed', $body ) ) {
			$test_ride_monitoring_requested = $this->boolean( $body['test_ride_monitoring_armed'] );
		}
		$supplementary_fields = array(
			'halo_nok_consent' => 'nok_alerts_enabled',
			'halo_proxy'       => 'proxy_authority_enabled',
			'halo_law'         => 'law_release_enabled',
			'halo_ai'          => 'research_enabled',
		);
		foreach ( $supplementary_fields as $request_field => $settings_field ) {
			if ( array_key_exists( $request_field, $body ) ) {
				$supplementary_requested[ $settings_field ] = $this->boolean( $body[ $request_field ] );
			}
		}
		if ( array_key_exists( 'mobile', $body ) || array_key_exists( 'mobile_number', $body ) ) {
			$data['mobile_number'] = sanitize_text_field( (string) ( $body['mobile'] ?? $body['mobile_number'] ) );
		}
		$text_fields = array( 'nok_name', 'nok_mobile', 'nok_relation', 'blood_type' );
		foreach ( $text_fields as $field ) {
			if ( array_key_exists( $field, $body ) ) {
				$data[ $field ] = sanitize_text_field( (string) $body[ $field ] );
			}
		}
		if ( array_key_exists( 'date_of_birth', $body ) ) {
			$raw_dob = trim( (string) $body['date_of_birth'] );
			$data['date_of_birth'] = $this->valid_date( $raw_dob );
			if ( '' !== $raw_dob && ! $data['date_of_birth'] ) {
				return Avenra_Halo_V2_Response::error( 'invalid_date_of_birth', __( 'Enter a valid date of birth.', 'avenra-halo-v2' ), 422 );
			}
		}
		if ( array_key_exists( 'weight_kg', $body ) ) {
			$data['weight_kg'] = $this->number( $body['weight_kg'], 0, 350, null );
		}
		if ( array_key_exists( 'medical_notes', $body ) ) {
			$data['medical_notes'] = $this->text_substr( sanitize_textarea_field( (string) $body['medical_notes'] ), 0, 2000 );
		}
		foreach ( array( 'halo_proxy', 'halo_emergency', 'halo_nok_consent', 'halo_law', 'halo_ai' ) as $field ) {
			if ( array_key_exists( $field, $body ) ) {
				$data[ $field ] = $this->boolean( $body[ $field ] ) ? '1' : '0';
			}
		}
		if ( array_key_exists( 'halo_nok_consent', $body ) && $this->boolean( $body['halo_nok_consent'] ) ) {
			$effective_dob = $data['date_of_birth'] ?? $this->valid_date( (string) ( $customer->date_of_birth ?? '' ) );
			$effective_nok = trim( (string) ( $data['nok_mobile'] ?? $customer->nok_mobile ?? '' ) );
			if ( ! $effective_dob || '' === $effective_nok ) {
				return Avenra_Halo_V2_Response::error( 'safety_profile_incomplete', __( 'Add a valid date of birth and next-of-kin mobile before enabling incident alerts.', 'avenra-halo-v2' ), 422 );
			}
		}
		$assist_after_update = null !== $assist_requested
			? $assist_requested
			: Avenra_Halo_V2_Emergency::instance()->assist_consent( (int) $customer->id );
		if ( $assist_after_update ) {
			if ( ! Avenra_Halo_V2_Emergency::instance()->provider_ready() && ! Avenra_Halo_V2_Emergency::instance()->assist_consent( (int) $customer->id ) ) {
				return Avenra_Halo_V2_Response::error( 'emergency_assist_unavailable', __( 'Emergency Assist cannot be enabled until responder alerting is configured.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$effective_dob    = $data['date_of_birth'] ?? $this->valid_date( (string) ( $customer->date_of_birth ?? '' ) );
			$effective_mobile = trim( (string) ( $data['mobile_number'] ?? $customer->mobile_number ?? $customer->mobile ?? '' ) );
			if ( ! $effective_dob || strlen( (string) preg_replace( '/\D+/', '', $effective_mobile ) ) < 7 ) {
				return Avenra_Halo_V2_Response::error( 'emergency_assist_profile_incomplete', __( 'Add a valid date of birth and rider mobile number before enabling Emergency Assist.', 'avenra-halo-v2' ), 422 );
			}
		}
		$data['updated_at'] = current_time( 'mysql', true );
		$data = $this->db->supported_data( $table, $data );

		// Snapshot writers acquire this lock before Assist and medical-consent
		// locks. Holding it through the customer write and transaction commit makes
		// a next-of-kin withdrawal a durable privacy boundary. NOK dispatchers use
		// the same lock and recheck the owned choice immediately before delivery.
		$safety_lock = $this->db->acquire_advisory_lock( 'emergency-safety-consent', (string) $customer->id, 2 );
		if ( ! $safety_lock ) {
			return Avenra_Halo_V2_Response::error( 'emergency_safety_consent_busy', __( 'Safety information is already being updated. Please retry.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		try {
		$transaction = false !== $wpdb->query( 'START TRANSACTION' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		if ( ! $transaction ) {
			return Avenra_Halo_V2_Response::error( 'safety_transaction_unavailable', __( 'Halo could not start a protected safety-settings update. Please retry.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( $data && false === $wpdb->update( $table, $data, array( 'id' => (int) $customer->id ) ) ) {
			if ( $transaction ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			}
			return Avenra_Halo_V2_Response::error( 'safety_update_failed', __( 'Your safety settings could not be saved.', 'avenra-halo-v2' ), 500 );
		}
		if ( $supplementary_requested ) {
			$supplementary_saved = $this->persist_supplementary_safety_choices( (int) $customer->id, $supplementary_requested );
			if ( is_wp_error( $supplementary_saved ) ) {
				if ( $transaction ) {
					$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				}
				return Avenra_Halo_V2_Response::error( $supplementary_saved->get_error_code(), $supplementary_saved->get_error_message(), 503, array( 'retryable' => true ) );
			}
		}
		if ( array_key_exists( 'nok_alerts_enabled', $supplementary_requested ) && ! $supplementary_requested['nok_alerts_enabled'] ) {
			$redacted = Avenra_Halo_V2_Emergency::instance()->redact_next_of_kin_snapshots_after_revocation( (int) $customer->id );
			if ( is_wp_error( $redacted ) ) {
				if ( $transaction ) {
					$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				}
				return Avenra_Halo_V2_Response::error( $redacted->get_error_code(), $redacted->get_error_message(), 503, array( 'retryable' => true ) );
			}
		}
		if ( null !== $assist_requested ) {
			$consent_version = sanitize_text_field( (string) ( $body['emergency_assist_consent_version'] ?? $body['consent_version'] ?? '' ) );
			$consent = Avenra_Halo_V2_Emergency::instance()->set_assist_consent( (int) $customer->id, $assist_requested, $consent_version );
			if ( is_wp_error( $consent ) ) {
				if ( $transaction ) {
					$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				}
				$error_data = $consent->get_error_data();
				$version_error = 'emergency_consent_version_required' === $consent->get_error_code();
				return Avenra_Halo_V2_Response::error(
					$consent->get_error_code(),
					$consent->get_error_message(),
					$version_error ? 409 : 503,
					array_merge( array( 'retryable' => ! $version_error ), is_array( $error_data ) ? $error_data : array() )
				);
			}
		}
		if ( null !== $medical_requested ) {
			$medical_consent_version = sanitize_text_field( (string) ( $body['medical_sharing_consent_version'] ?? '' ) );
			$medical_consent = Avenra_Halo_V2_Emergency::instance()->set_medical_sharing_consent( (int) $customer->id, $medical_requested, $medical_consent_version );
			if ( is_wp_error( $medical_consent ) ) {
				if ( $transaction ) {
					$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				}
				$error_data = $medical_consent->get_error_data();
				$version_error = 'emergency_medical_consent_version_required' === $medical_consent->get_error_code();
				return Avenra_Halo_V2_Response::error(
					$medical_consent->get_error_code(),
					$medical_consent->get_error_message(),
					$version_error ? 409 : 503,
					array_merge( array( 'retryable' => ! $version_error ), is_array( $error_data ) ? $error_data : array() )
				);
			}
		}
		if ( null !== $test_ride_monitoring_requested ) {
			$test_ride_consent_version = sanitize_text_field( (string) ( $body['test_ride_monitoring_consent_version'] ?? '' ) );
			$test_ride_expected_arm_id_supplied = array_key_exists( 'test_ride_monitoring_expected_arm_id', $body );
			$test_ride_expected_arm_id = sanitize_text_field( (string) ( $body['test_ride_monitoring_expected_arm_id'] ?? '' ) );
			if ( ! $test_ride_monitoring_requested && $test_ride_expected_arm_id_supplied && ! preg_match( '/^[A-Za-z0-9_-]{24,64}$/', $test_ride_expected_arm_id ) ) {
				if ( $transaction ) {
					$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				}
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_expected_arm_id_invalid', __( 'The one-ride permission identifier was invalid.', 'avenra-halo-v2' ), 422, array( 'retryable' => false ) );
			}
			$test_ride_expected_consented_at = sanitize_text_field( (string) ( $body['test_ride_monitoring_expected_consented_at'] ?? '' ) );
			$test_ride_consent = Avenra_Halo_V2_Emergency::instance()->set_test_ride_monitoring_arm( (int) $customer->id, $test_ride_monitoring_requested, $test_ride_consent_version, $test_ride_expected_arm_id, $test_ride_expected_consented_at );
			if ( is_wp_error( $test_ride_consent ) ) {
				if ( $transaction ) {
					$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				}
				$error_data = $test_ride_consent->get_error_data();
				$version_error = 'test_ride_monitoring_consent_version_required' === $test_ride_consent->get_error_code();
				return Avenra_Halo_V2_Response::error(
					$test_ride_consent->get_error_code(),
					$test_ride_consent->get_error_message(),
					$version_error ? 409 : 503,
					array_merge( array( 'retryable' => ! $version_error ), is_array( $error_data ) ? $error_data : array() )
				);
			}
		}
		if ( false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return Avenra_Halo_V2_Response::error( 'safety_commit_failed', __( 'Halo could not confirm that your safety settings were saved. Please retry.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}

		$updated_customer = $this->db->customer_by_id( (int) $customer->id );
		if ( ! $updated_customer ) {
			return Avenra_Halo_V2_Response::error( 'safety_refresh_failed', __( 'Your safety settings were saved, but Halo could not refresh them. Please reload.', 'avenra-halo-v2' ), 503 );
		}
		return Avenra_Halo_V2_Response::success( $this->safety_data( $updated_customer ) );
		} finally {
			$this->db->release_advisory_lock( $safety_lock );
		}
		}

	/**
	 * Persist choices missing from some V1 customer schemas. The caller holds the
	 * emergency-safety-consent lock and an open transaction. Nullable owned
	 * columns distinguish an explicit OFF choice from an unmigrated legacy value.
	 *
	 * @param array<string,bool> $choices
	 * @return bool|WP_Error
	 */
	private function persist_supplementary_safety_choices( int $customer_id, array $choices ): bool|WP_Error {
		global $wpdb;

		$table   = $this->db->table( 'emergency_settings' );
		$allowed = array( 'nok_alerts_enabled', 'proxy_authority_enabled', 'law_release_enabled', 'research_enabled' );
		if ( $customer_id < 1 || ! $this->db->table_exists( $table ) ) {
			return new WP_Error( 'safety_choice_storage_unavailable', __( 'Halo safety-choice storage is not ready.', 'avenra-halo-v2' ) );
		}
		foreach ( $allowed as $column ) {
			if ( ! $this->db->has_column( $table, $column ) ) {
				return new WP_Error( 'safety_choice_storage_unavailable', __( 'Halo safety-choice storage needs an update before these settings can be saved.', 'avenra-halo-v2' ) );
			}
		}

		$data = array();
		foreach ( $allowed as $column ) {
			if ( array_key_exists( $column, $choices ) ) {
				$data[ $column ] = $choices[ $column ] ? 1 : 0;
			}
		}
		if ( ! $data ) {
			return true;
		}

		$now = current_time( 'mysql', true );
		$data['updated_at'] = $now;
		$exists = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT customer_id FROM `' . esc_sql( $table ) . '` WHERE customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id
			)
		);
		if ( $exists > 0 ) {
			$saved = $wpdb->update( $table, $data, array( 'customer_id' => $customer_id ) );
		} else {
			$data['customer_id'] = $customer_id;
			$data['created_at']  = $now;
			$saved = $wpdb->insert( $table, $data );
		}
		if ( false === $saved ) {
			return new WP_Error( 'safety_choice_save_failed', __( 'Your safety choices could not be saved.', 'avenra-halo-v2' ) );
		}

		$stored = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $table ) . '` WHERE customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$customer_id
			)
		);
		if ( ! is_object( $stored ) ) {
			return new WP_Error( 'safety_choice_verify_failed', __( 'Halo could not verify your saved safety choices.', 'avenra-halo-v2' ) );
		}
		foreach ( $choices as $column => $enabled ) {
			if ( ! in_array( $column, $allowed, true ) || ! property_exists( $stored, $column ) || ( $enabled ? '1' : '0' ) !== (string) $stored->{$column} ) {
				return new WP_Error( 'safety_choice_verify_failed', __( 'Halo could not verify every saved safety choice.', 'avenra-halo-v2' ) );
			}
		}
		return true;
	}

	public function test_safety_alert( WP_REST_Request $request ): WP_REST_Response {
		$body     = $this->body( $request );
		$customer = $this->auth->customer();
		if ( empty( $customer->nok_mobile ) ) {
			return Avenra_Halo_V2_Response::error( 'nok_mobile_missing', __( 'Save a next-of-kin mobile number before sending a test.', 'avenra-halo-v2' ), 409 );
		}
		if ( empty( $this->safety_data( $customer )['halo_nok_consent'] ) ) {
			return Avenra_Halo_V2_Response::error( 'nok_alert_not_enabled', __( 'Enable next-of-kin alerts before sending a test.', 'avenra-halo-v2' ), 409 );
		}
		if ( ! $this->consume_rate_limit( 'nok-test-account', (string) $this->auth->customer_id(), 3, 15 * MINUTE_IN_SECONDS ) || ! $this->consume_rate_limit( 'nok-test-ip', $this->request_ip(), 10, 15 * MINUTE_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'alert_throttled', __( 'Please wait before sending another test alert.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 900 ) );
		}

		$position = is_array( $body['position'] ?? null ) ? $body['position'] : array();
		$lat = $this->coordinate( $body['lat'] ?? $body['latitude'] ?? $position['lat'] ?? null, -90, 90 );
		$lng = $this->coordinate( $body['lng'] ?? $body['longitude'] ?? $position['lng'] ?? null, -180, 180 );

		$result = $this->perform_nok_safety_alert(
			'test',
			array( 'lat' => $lat, 'lng' => $lng, 'event_id' => Avenra_Halo_V2_Response::request_id() ),
			$customer,
			'send_test_nok_alert'
		);
		if ( is_wp_error( $result ) ) {
			$status = 'nok_alert_not_enabled' === $result->get_error_code() ? 409 : 503;
			return Avenra_Halo_V2_Response::error( $result->get_error_code(), $result->get_error_message(), $status, array( 'retryable' => 503 === $status ) );
		}
		return Avenra_Halo_V2_Response::success( array( 'sent' => true, 'message' => __( 'The test alert was sent to your saved next of kin.', 'avenra-halo-v2' ), 'provider' => $result ) );
	}

	/** Record the pre-alert state used by the rider's 20-second cancellation window. */
	public function record_incident_candidate( WP_REST_Request $request ): WP_REST_Response {
		$body        = $this->body( $request );
		$customer_id = (int) $this->auth->customer_id();
		$event_id    = sanitize_text_field( (string) ( $body['event_id'] ?? '' ) );
		if ( ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $event_id ) ) {
			return Avenra_Halo_V2_Response::error( 'event_id_required', __( 'A stable crash event identifier is required.', 'avenra-halo-v2' ), 422 );
		}
		$emergency = Avenra_Halo_V2_Emergency::instance();
		if ( ! $emergency->assist_consent( $customer_id ) ) {
			return Avenra_Halo_V2_Response::error( 'emergency_consent_required', __( 'Emergency Assist is not enabled on this profile.', 'avenra-halo-v2' ), 409 );
		}
		$encoded = wp_json_encode( $body );
		if ( ! is_string( $encoded ) || strlen( $encoded ) > 128 * KB_IN_BYTES ) {
			return Avenra_Halo_V2_Response::error( 'incident_payload_too_large', __( 'The Emergency Assist incident contained too much telemetry.', 'avenra-halo-v2' ), 413 );
		}
		if ( ! $this->consume_rate_limit( 'incident-candidate-account', (string) $customer_id, 20, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'incident_throttled', __( 'Halo could not record another possible incident yet.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		$result = $emergency->record_candidate( $customer_id, $event_id, $body, 'automatic' );
		if ( is_wp_error( $result ) ) {
			$status = in_array( $result->get_error_code(), array( 'emergency_consent_required', 'emergency_incident_busy' ), true ) ? 409 : 503;
			return Avenra_Halo_V2_Response::error( $result->get_error_code(), $result->get_error_message(), $status, array( 'retryable' => 503 === $status ) );
		}
		return Avenra_Halo_V2_Response::success( $result, empty( $result['idempotent'] ) ? 201 : 200 );
	}

	/** Cancellation is deliberately accepted only while an incident is a candidate. */
	public function cancel_incident_candidate( WP_REST_Request $request ): WP_REST_Response {
		$event_id    = sanitize_text_field( (string) $request['event_id'] );
		$customer_id = (int) $this->auth->customer_id();
		if ( ! $this->consume_rate_limit( 'incident-cancel-account', (string) $customer_id, 30, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'incident_throttled', __( 'Halo could not process another incident cancellation yet.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		$body   = $this->body( $request );
		$reason = sanitize_key( (string) ( $body['reason'] ?? 'rider_cancelled' ) );
		$result = Avenra_Halo_V2_Emergency::instance()->cancel( $customer_id, $event_id, $reason );
		if ( is_wp_error( $result ) ) {
			$code      = $result->get_error_code();
			$retryable = in_array( $code, array( 'emergency_incident_busy', 'emergency_cancel_failed', 'emergency_storage_unavailable' ), true );
			$status    = 'emergency_incident_missing' === $code ? 404 : ( 'emergency_event_invalid' === $code ? 422 : ( $retryable ? 503 : 409 ) );
			return Avenra_Halo_V2_Response::error( $code, $result->get_error_message(), $status, array( 'retryable' => $retryable ) );
		}
		return Avenra_Halo_V2_Response::success( $result );
	}

	/** Return the durable, ownership-scoped state used to reconcile ambiguous requests. */
	public function get_incident_status( WP_REST_Request $request ): WP_REST_Response {
		$event_id = sanitize_text_field( (string) $request['event_id'] );
		$result   = Avenra_Halo_V2_Emergency::instance()->get_incident_status( (int) $this->auth->customer_id(), $event_id );
		if ( ! is_array( $result ) ) {
			return Avenra_Halo_V2_Response::error( 'emergency_incident_missing', __( 'The Emergency Assist incident could not be found.', 'avenra-halo-v2' ), 404 );
		}
		return Avenra_Halo_V2_Response::success( $result );
	}

	/** Accept a bounded live location sample for an incident owned by this rider. */
	public function update_incident_position( WP_REST_Request $request ): WP_REST_Response {
		$event_id    = sanitize_text_field( (string) $request['event_id'] );
		$customer_id = (int) $this->auth->customer_id();
		$body        = $this->body( $request );
		$lat         = $this->coordinate( $body['lat'] ?? $body['latitude'] ?? null, -90, 90 );
		$lng         = $this->coordinate( $body['lng'] ?? $body['longitude'] ?? null, -180, 180 );
		if ( null === $lat || null === $lng ) {
			return Avenra_Halo_V2_Response::error( 'location_required', __( 'A valid GPS position is required for an Emergency Assist update.', 'avenra-halo-v2' ), 422 );
		}
		$encoded = wp_json_encode( $body );
		if ( ! is_string( $encoded ) || strlen( $encoded ) > 32 * KB_IN_BYTES ) {
			return Avenra_Halo_V2_Response::error( 'incident_payload_too_large', __( 'The Emergency Assist position update contained too much data.', 'avenra-halo-v2' ), 413 );
		}
		if ( ! $this->consume_rate_limit( 'incident-position-account', (string) $customer_id, 900, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'incident_position_throttled', __( 'Halo is receiving position updates too quickly.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 5 ) );
		}
		// Never forward arbitrary top-level telemetry here. In particular,
		// occurred_at and speed_mph in a live sample must not replace the frozen
		// impact timestamp, speed or severity held in the incident snapshot.
		$recorded_at = $body['recorded_at'] ?? $body['location_timestamp'] ?? $body['occurred_at'] ?? null;
		$movement    = array_key_exists( 'moving', $body ) ? ( $this->boolean( $body['moving'] ) ? 'moving' : 'stationary' ) : '';
		$location    = array(
			'lat'       => $lat,
			'lng'       => $lng,
			'accuracy'  => $this->number( $body['accuracy_m'] ?? $body['accuracy'] ?? null, 0, 10000, null ),
			'altitude'  => $this->number( $body['altitude'] ?? $body['altitude_m'] ?? null, -1000, 12000, null ),
			'heading'   => $this->number( $body['heading'] ?? null, 0, 360, null ),
			'movement'  => $movement,
			'timestamp' => $recorded_at,
			'source'    => 'rider_live_update',
		);
		$position_update = array(
			'location'     => $location,
			'recent_route' => array( array( 'lat' => $lat, 'lng' => $lng ) ),
			'client_ride_id'=> $this->text_substr( sanitize_text_field( (string) ( $body['client_ride_id'] ?? '' ) ), 0, 80 ),
			'vehicle_id'    => absint( $body['vehicle_id'] ?? 0 ),
		);
		if ( is_array( $body['device_state'] ?? null ) ) {
			$device_state = $body['device_state'];
			$position_update['device_state'] = array(
				'online'            => $this->boolean( $device_state['online'] ?? true ),
				'visibility'        => sanitize_key( (string) ( $device_state['visibility'] ?? '' ) ),
				'screen_orientation'=> $this->text_substr( sanitize_text_field( (string) ( $device_state['screen_orientation'] ?? $device_state['screenOrientation'] ?? '' ) ), 0, 48 ),
			);
		}
		$result = Avenra_Halo_V2_Emergency::instance()->update_position( $customer_id, $event_id, $position_update );
		if ( is_wp_error( $result ) ) {
			$status = 'emergency_incident_missing' === $result->get_error_code() ? 404 : ( 'emergency_incident_not_active' === $result->get_error_code() ? 409 : 503 );
			return Avenra_Halo_V2_Response::error( $result->get_error_code(), $result->get_error_message(), $status, array( 'retryable' => 503 === $status ) );
		}
		return Avenra_Halo_V2_Response::success( $result );
	}

	public function crash_safety_alert( WP_REST_Request $request ): WP_REST_Response {
		$body      = $this->body( $request );
		$incident  = is_array( $body['incident'] ?? null ) ? $body['incident'] : array();
		$position  = is_array( $body['position'] ?? null ) ? $body['position'] : ( is_array( $incident['position'] ?? null ) ? $incident['position'] : ( is_array( $incident['location'] ?? null ) ? $incident['location'] : array() ) );
		$customer          = $this->auth->customer();
		$safety            = $this->safety_data( $customer );
		$alert_mode        = sanitize_key( (string) ( $body['alert_mode'] ?? '' ) );
		$legacy_nok_route  = str_ends_with( (string) $request->get_route(), '/safety/nok/alert' );
		$assist_requested  = ! $legacy_nok_route && 'emergency_assist' === $alert_mode;
		$assist_consented  = ! empty( $safety['emergency_assist_enabled'] );
		$event_id  = sanitize_text_field( (string) ( $body['event_id'] ?? $incident['id'] ?? '' ) );
		if ( ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $event_id ) ) {
			return Avenra_Halo_V2_Response::error( 'event_id_required', __( 'A stable crash event identifier is required.', 'avenra-halo-v2' ), 422 );
		}
		if ( $assist_requested && ! $assist_consented ) {
			return Avenra_Halo_V2_Response::error( 'emergency_consent_required', __( 'Emergency Assist is not enabled on this profile.', 'avenra-halo-v2' ), 409 );
		}
		if ( ! $assist_requested && ( empty( $customer->nok_mobile ) || ! $safety['halo_nok_consent'] ) ) {
			return Avenra_Halo_V2_Response::error( 'nok_alert_not_enabled', __( 'Next-of-kin crash alerts are not enabled on this profile.', 'avenra-halo-v2' ), 409 );
		}

		$emergency = Avenra_Halo_V2_Emergency::instance();
		if ( $assist_requested ) {
			$durable = $emergency->get_incident_status( (int) $this->auth->customer_id(), $event_id );
			if ( is_array( $durable ) && 'candidate' !== (string) ( $durable['status'] ?? '' ) ) {
				if ( ! empty( $durable['accepted'] ) ) {
					$durable['idempotent']       = true;
					$durable['provider_accepted'] = true;
					return Avenra_Halo_V2_Response::success( $durable );
				}
				if ( 'cancelled' === (string) ( $durable['status'] ?? '' ) ) {
					return Avenra_Halo_V2_Response::error( 'emergency_incident_cancelled', __( 'This Emergency Assist incident was cancelled before activation.', 'avenra-halo-v2' ), 409, array( 'retryable' => false ) );
				}
				$delivery_states = array( (string) ( $durable['primary_status'] ?? '' ), (string) ( $durable['backup_status'] ?? '' ) );
				if ( array_intersect( $delivery_states, array( 'pending', 'attempting' ) ) ) {
					$durable['processing'] = true;
					return Avenra_Halo_V2_Response::success( $durable, 202 );
				}
				return Avenra_Halo_V2_Response::error( 'emergency_responder_alert_unconfirmed', __( 'Halo opened the incident but could not confirm that either responder alert was accepted. Call 999 now if anyone may be injured.', 'avenra-halo-v2' ), 503, array( 'retryable' => false, 'incident_id' => sanitize_text_field( (string) ( $durable['incident_id'] ?? '' ) ) ) );
			}
		}

		$key = 'avh2_crash_' . substr( hash_hmac( 'sha256', $this->auth->customer_id() . '|' . ( $assist_requested ? 'assist' : 'nok' ) . '|' . $event_id, wp_salt( 'auth' ) ), 0, 40 );
		if ( ! $assist_requested ) {
			$cached = get_transient( $key );
			if ( is_array( $cached ) ) {
				return Avenra_Halo_V2_Response::success( array_merge( $cached, array( 'idempotent' => true ) ) );
			}
		}
		$occurred_raw = $body['queued_at'] ?? $body['occurred_at'] ?? $body['detected_at'] ?? $incident['queuedAt'] ?? $incident['occurredAt'] ?? $incident['detectedAt'] ?? '';
		if ( '' !== trim( (string) $occurred_raw ) ) {
			if ( is_numeric( $occurred_raw ) ) {
				$numeric_time = (float) $occurred_raw;
				$occurred_at = (int) ( $numeric_time > 100000000000 ? $numeric_time / 1000 : $numeric_time );
			} else {
				$parsed_time = strtotime( (string) $occurred_raw );
				$occurred_at = false === $parsed_time ? 0 : $parsed_time;
			}
			$maximum_age = max( MINUTE_IN_SECONDS, (int) apply_filters( 'avenra_halo_v2_crash_alert_max_age', 15 * MINUTE_IN_SECONDS, $customer ) );
			if ( $occurred_at < 1 || $occurred_at > time() + 5 * MINUTE_IN_SECONDS ) {
				return Avenra_Halo_V2_Response::error( 'invalid_incident_time', __( 'The crash incident time was invalid.', 'avenra-halo-v2' ), 422, array( 'retryable' => false ) );
			}
			if ( time() - $occurred_at > $maximum_age ) {
				return Avenra_Halo_V2_Response::error( 'stale_crash_event', __( 'This incident is too old to open an automatic alert. Contact the appropriate responder directly if help is still needed.', 'avenra-halo-v2' ), 409, array( 'retryable' => false, 'stale' => true, 'maximum_age_seconds' => $maximum_age ) );
			}
		} else {
			$occurred_at = time();
		}
		$lat = $this->coordinate( $body['lat'] ?? $body['latitude'] ?? $position['lat'] ?? $position['latitude'] ?? null, -90, 90 );
		$lng = $this->coordinate( $body['lng'] ?? $body['longitude'] ?? $position['lng'] ?? $position['longitude'] ?? null, -180, 180 );
		if ( null === $lat || null === $lng ) {
			return Avenra_Halo_V2_Response::error( 'location_required', __( 'A GPS position is required before a crash alert can be sent.', 'avenra-halo-v2' ), 422 );
		}
		$event_bucket = $this->auth->customer_id() . '|nok|' . $event_id;

		if ( $assist_requested ) {
			$encoded = wp_json_encode( $body );
			if ( ! is_string( $encoded ) || strlen( $encoded ) > 128 * KB_IN_BYTES ) {
				return Avenra_Halo_V2_Response::error( 'incident_payload_too_large', __( 'The Emergency Assist incident contained too much telemetry.', 'avenra-halo-v2' ), 413, array( 'retryable' => false ) );
			}
			if ( ! $emergency->provider_ready() ) {
				return Avenra_Halo_V2_Response::error( 'emergency_assist_unavailable', __( 'Emergency Assist is not configured to alert the response team. Call 999 now if anyone may be injured.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			if ( ! $this->consume_rate_limit( 'crash-alert-account', (string) $this->auth->customer_id(), 6, HOUR_IN_SECONDS ) ) {
				return Avenra_Halo_V2_Response::error( 'alert_throttled', __( 'Halo could not send another incident alert yet.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
			}
			$body['event_id']    = $event_id;
			$body['occurred_at'] = gmdate( DATE_RFC3339, $occurred_at );
			$body['lat']         = $lat;
			$body['lng']         = $lng;
			$result = $emergency->activate( (int) $this->auth->customer_id(), $event_id, $body, 'automatic' );
			if ( is_wp_error( $result ) ) {
				return Avenra_Halo_V2_Response::error( $result->get_error_code(), $result->get_error_message(), 503, array( 'retryable' => true ) );
			}
			if ( empty( $result['accepted'] ) ) {
				return Avenra_Halo_V2_Response::error( 'emergency_responder_alert_unconfirmed', __( 'Halo opened the incident but could not confirm that either responder alert was accepted. Call 999 now if anyone may be injured.', 'avenra-halo-v2' ), 503, array( 'retryable' => false, 'incident_id' => sanitize_text_field( (string) ( $result['incident_id'] ?? '' ) ) ) );
			}
			$response = array_merge(
				$result,
				array(
					'emergency_assist' => true,
					'provider_accepted'=> true,
					'message'          => __( 'A responder SMS was accepted by the configured service. Emergency Assist has not called 999.', 'avenra-halo-v2' ),
				)
			);
			return Avenra_Halo_V2_Response::success( $response, 202 );
		}
		if ( ! $this->consume_rate_limit( 'crash-alert-account', (string) $this->auth->customer_id(), 6, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'alert_throttled', __( 'Halo could not send another incident alert yet.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		if ( ! $this->consume_rate_limit( 'crash-event', $event_bucket, 1, DAY_IN_SECONDS ) ) {
			$cached = get_transient( $key );
			if ( is_array( $cached ) ) {
				return Avenra_Halo_V2_Response::success( array_merge( $cached, array( 'idempotent' => true ) ) );
			}
			return Avenra_Halo_V2_Response::error( 'crash_event_in_progress', __( 'Halo is already processing this incident alert.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		$payload = array(
			'event_id'       => $event_id,
			'occurred_at'    => gmdate( DATE_RFC3339, $occurred_at ),
			'lat'            => $lat,
			'lng'            => $lng,
			'speed'          => $this->number( $body['speed_mph'] ?? $body['speed'] ?? $incident['speedMph'] ?? $incident['speed_mph'] ?? 0, 0, 250, 0 ),
			'max_lean_left'  => $this->number( $body['max_lean_left'] ?? $incident['maxLeanLeft'] ?? 0, 0, 90, 0 ),
			'max_lean_right' => $this->number( $body['max_lean_right'] ?? $incident['maxLeanRight'] ?? 0, 0, 90, 0 ),
			'peak_g_force'   => $this->number( $body['peak_g_force'] ?? $incident['peakG'] ?? $incident['gForce'] ?? 0, 0, 30, 0 ),
			'battery'        => $this->text_substr( sanitize_text_field( (string) ( $body['battery'] ?? '' ) ), 0, 80 ),
		);
		$result = $this->perform_nok_safety_alert( 'crash', $payload, $customer, 'send_nok_crash_alert_v2' );
		if ( is_wp_error( $result ) ) {
			$this->db->clear_rate_limit( 'crash-event', $event_bucket );
			$status = 'nok_alert_not_enabled' === $result->get_error_code() ? 409 : 503;
			return Avenra_Halo_V2_Response::error( $result->get_error_code(), $result->get_error_message(), $status, array( 'retryable' => 503 === $status ) );
		}

		$response = array( 'sent' => true, 'event_id' => $event_id, 'provider' => $result );
		set_transient( $key, $response, DAY_IN_SECONDS );
		return Avenra_Halo_V2_Response::success( $response, 202 );
	}

	public function vehicles( WP_REST_Request $request ): WP_REST_Response {
		$vehicles = array_map( array( $this, 'serialise_vehicle' ), $this->vehicle_rows() );
		return Avenra_Halo_V2_Response::success( $vehicles, 200, array( 'count' => count( $vehicles ) ) );
	}

	public function latest_vehicle( WP_REST_Request $request ): WP_REST_Response {
		$vehicles = $this->vehicle_rows();
		return Avenra_Halo_V2_Response::success( $vehicles ? $this->serialise_vehicle( $vehicles[0] ) : null );
	}

	public function get_ride_profiles( WP_REST_Request $request ): WP_REST_Response {
		$order = $this->owned_order( (int) $request['id'] );
		if ( ! $order ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_not_found', __( 'That vehicle is not attached to your account.', 'avenra-halo-v2' ), 404 );
		}

		$factory = $this->ride_profiles_from_order( $order );
		return Avenra_Halo_V2_Response::success( array( 'ride_profile' => $this->client_ride_profile( $factory ), 'factory_profile' => $factory ) );
	}

	public function update_ride_profiles( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$order = $this->owned_order( (int) $request['id'] );
		if ( ! $order ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_not_found', __( 'That vehicle is not attached to your account.', 'avenra-halo-v2' ), 404 );
		}

		$table = $this->db->table( 'orders' );
		if ( ! $this->db->has_column( $table, 'configuration_data' ) ) {
			return Avenra_Halo_V2_Response::error( 'profiles_unavailable', __( 'Ride profiles are not enabled for this vehicle record.', 'avenra-halo-v2' ), 503 );
		}

		$body     = $this->body( $request );
		$profile_aliases = array(
			'eco' => 'Profile A', 'rain' => 'Profile A', 'city' => 'Profile B',
			'road' => 'Profile C', 'sport' => 'Profile E', 'track' => 'Profile E',
		);
		$regen_aliases = array( 'off' => 'Off', 'low' => 'Light', 'light' => 'Light', 'medium' => 'Medium', 'high' => 'Heavy', 'heavy' => 'Heavy' );
		foreach ( array( 'mode_1', 'mode_2', 'mode_3' ) as $mode_key ) {
			$alias = strtolower( sanitize_text_field( (string) ( $body[ $mode_key ] ?? '' ) ) );
			if ( isset( $profile_aliases[ $alias ] ) ) {
				$body[ $mode_key ] = $profile_aliases[ $alias ];
			}
		}
		if ( isset( $body['regeneration'] ) && ! isset( $body['regen_profile'] ) ) {
			$body['regen_profile'] = $body['regeneration'];
		}
		$regen_alias = strtolower( sanitize_text_field( (string) ( $body['regen_profile'] ?? '' ) ) );
		if ( isset( $regen_aliases[ $regen_alias ] ) ) {
			$body['regen_profile'] = $regen_aliases[ $regen_alias ];
		}
		$profiles = array( 'Profile A', 'Profile B', 'Profile C', 'Profile D', 'Profile E' );
		$regens   = array( 'Off', 'Light', 'Medium', 'Heavy' );
		$values   = array(
			'mode_1'        => sanitize_text_field( (string) ( $body['mode_1'] ?? '' ) ),
			'mode_2'        => sanitize_text_field( (string) ( $body['mode_2'] ?? '' ) ),
			'mode_3'        => sanitize_text_field( (string) ( $body['mode_3'] ?? '' ) ),
			'regen_profile' => sanitize_text_field( (string) ( $body['regen_profile'] ?? '' ) ),
		);
		if ( ! in_array( $values['mode_1'], $profiles, true ) || ! in_array( $values['mode_2'], $profiles, true ) || ! in_array( $values['mode_3'], $profiles, true ) || ! in_array( $values['regen_profile'], $regens, true ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_ride_profiles', __( 'Choose a valid mapping for each ride mode and regeneration level.', 'avenra-halo-v2' ), 422 );
		}

		$config = json_decode( (string) ( $order->configuration_data ?? '' ), true );
		$config = is_array( $config ) ? $config : array();
		$config = array_merge( $config, $values );
		if ( false === $wpdb->update( $table, array( 'configuration_data' => wp_json_encode( $config ) ), array( 'id' => (int) $order->id, 'customer_id' => $this->auth->customer_id() ) ) ) {
			return Avenra_Halo_V2_Response::error( 'ride_profiles_update_failed', __( 'Your ride profiles could not be saved.', 'avenra-halo-v2' ), 500 );
		}

		do_action( 'avenra_halo_v2_ride_profiles_updated', (int) $order->id, $this->auth->customer_id(), $values );
		return Avenra_Halo_V2_Response::success( array( 'ride_profile' => $this->client_ride_profile( $values ), 'factory_profile' => $values, 'applied' => false ) );
	}

	public function claim_used_vehicle( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		if ( ! $this->consume_rate_limit( 'vehicle-claim-account', (string) $this->auth->customer_id(), 3, DAY_IN_SECONDS ) || ! $this->consume_rate_limit( 'vehicle-claim-ip', $this->request_ip(), 10, DAY_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_claim_throttled', __( 'Too many ownership claims were submitted. Please contact Avenrà support if you need help.', 'avenra-halo-v2' ), 429, array( 'retry_after' => DAY_IN_SECONDS ) );
		}
		$body  = $this->body( $request );
		$vin   = strtoupper( preg_replace( '/[^A-HJ-NPR-Z0-9]/', '', (string) ( $body['vin'] ?? '' ) ) );
		$model = sanitize_text_field( (string) ( $body['model'] ?? '' ) );
		$colour_input = trim( (string) ( $body['color'] ?? '' ) );
		$colour = sanitize_text_field( '' !== $colour_input ? $colour_input : (string) ( $body['colour'] ?? '' ) );
		$reg   = strtoupper( sanitize_text_field( (string) ( $body['registration_plate'] ?? $body['registration'] ?? '' ) ) );
		$mileage_raw = $body['current_mileage'] ?? $body['mileage'] ?? null;
		$first_registered = $this->valid_date( (string) ( $body['first_registration_date'] ?? '' ) );
		$last_service_raw = trim( (string) ( $body['last_service_date'] ?? '' ) );
		$last_service = $this->valid_date( $last_service_raw );
		$today = gmdate( 'Y-m-d' );
		if ( 17 !== strlen( $vin ) || $this->text_length( $model ) < 2 || $this->text_length( $model ) > 100 || '' === $reg || $this->text_length( $colour ) < 2 || $this->text_length( $colour ) > 80 ) {
			return Avenra_Halo_V2_Response::error( 'invalid_vehicle_claim', __( 'Enter the model, colour, registration and complete 17-character VIN.', 'avenra-halo-v2' ), 422 );
		}
		if ( ! is_numeric( $mileage_raw ) || (float) $mileage_raw < 0 || (float) $mileage_raw > 1000000 ) {
			return Avenra_Halo_V2_Response::error( 'invalid_vehicle_mileage', __( 'Enter the vehicle’s current non-negative mileage.', 'avenra-halo-v2' ), 422 );
		}
		if ( ! $first_registered || $first_registered < '1950-01-01' || $first_registered > $today ) {
			return Avenra_Halo_V2_Response::error( 'invalid_first_registration_date', __( 'Enter a valid first-registration date that is not in the future.', 'avenra-halo-v2' ), 422 );
		}
		if ( '' !== $last_service_raw && ( ! $last_service || $last_service > $today ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_last_service_date', __( 'Enter a valid last-service date that is not in the future.', 'avenra-halo-v2' ), 422 );
		}

		$table = $this->db->table( 'orders' );
		if ( $this->db->has_column( $table, 'vin' ) ) {
			$existing = $wpdb->get_row( $wpdb->prepare( 'SELECT id, customer_id FROM `' . esc_sql( $table ) . '` WHERE UPPER(vin) = %s LIMIT 1', $vin ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( $existing ) {
				return Avenra_Halo_V2_Response::error( 'vehicle_already_registered', __( 'That VIN is already registered. Avenrà support can help transfer ownership.', 'avenra-halo-v2' ), 409 );
			}
		}

		$data = $this->db->supported_data(
			$table,
			array(
				'customer_id'             => $this->auth->customer_id(),
				'model'                   => $model,
				'color'                   => $colour,
				'colour'                  => $colour,
				'registration_plate'      => $reg,
				'vin'                     => $vin,
				'current_mileage'         => (int) round( (float) $mileage_raw ),
				'first_registration_date' => $first_registered,
				'last_service_date'       => $last_service,
				'order_status'            => 'Ownership verification pending',
				'order_date'              => current_time( 'mysql', true ),
				'updated_at'              => current_time( 'mysql', true ),
			)
		);
		if ( ! $wpdb->insert( $table, $data ) ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_claim_failed', __( 'We could not submit the ownership claim.', 'avenra-halo-v2' ), 500 );
		}

		$order = $this->owned_order( (int) $wpdb->insert_id );
		do_action( 'avenra_halo_v2_used_vehicle_claimed', (int) $wpdb->insert_id, $this->auth->customer_id() );
		return Avenra_Halo_V2_Response::success( $this->serialise_vehicle( $order ), 202 );
	}

	public function upload_vehicle_photo( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		if ( ! $this->consume_rate_limit( 'vehicle-photo-account', (string) $this->auth->customer_id(), 10, HOUR_IN_SECONDS ) || ! $this->consume_rate_limit( 'vehicle-photo-ip', $this->request_ip(), 30, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_photo_throttled', __( 'Too many vehicle photos were submitted. Please wait and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		$order = $this->owned_order( (int) $request['id'] );
		if ( ! $order ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_not_found', __( 'That vehicle is not attached to your account.', 'avenra-halo-v2' ), 404 );
		}

		$files = $request->get_file_params();
		$key   = isset( $files['photo'] ) ? 'photo' : ( isset( $files['bike_photo'] ) ? 'bike_photo' : '' );
		$file  = $key ? $files[ $key ] : null;
		if ( ! is_array( $file ) || empty( $file['tmp_name'] ) || UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
			return Avenra_Halo_V2_Response::error( 'photo_missing', __( 'Choose a vehicle photo to upload.', 'avenra-halo-v2' ), 422 );
		}
		$photo_max_bytes = (int) apply_filters( 'avenra_halo_v2_vehicle_photo_max_bytes', 8 * MB_IN_BYTES );
		if ( (int) $file['size'] < 1 || (int) $file['size'] > $photo_max_bytes ) {
			return Avenra_Halo_V2_Response::error( 'photo_too_large', __( 'That vehicle photo exceeds the permitted size.', 'avenra-halo-v2' ), 413, array( 'max_bytes' => $photo_max_bytes ) );
		}

		$checked = wp_check_filetype_and_ext(
			(string) $file['tmp_name'],
			(string) $file['name'],
			array( 'jpg|jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp' )
		);
		if ( empty( $checked['type'] ) ) {
			return Avenra_Halo_V2_Response::error( 'photo_type_not_allowed', __( 'Upload a JPG, PNG or WebP image.', 'avenra-halo-v2' ), 415 );
		}
		$image_info = @getimagesize( (string) $file['tmp_name'] ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		$max_pixels = max( 1000000, (int) apply_filters( 'avenra_halo_v2_vehicle_photo_max_pixels', 40000000 ) );
		if ( ! is_array( $image_info ) || empty( $image_info[0] ) || empty( $image_info[1] ) || ( ! empty( $image_info['mime'] ) && $image_info['mime'] !== $checked['type'] ) ) {
			return Avenra_Halo_V2_Response::error( 'photo_content_invalid', __( 'That file is not a valid JPG, PNG or WebP image.', 'avenra-halo-v2' ), 415 );
		}
		if ( (float) $image_info[0] * (float) $image_info[1] > (float) $max_pixels ) {
			return Avenra_Halo_V2_Response::error( 'photo_dimensions_too_large', __( 'That image has too many pixels. Choose a smaller vehicle photo.', 'avenra-halo-v2' ), 413, array( 'max_pixels' => $max_pixels ) );
		}

		$customer_id = $this->auth->customer_id();
		$lock        = $this->db->acquire_advisory_lock( 'vehicle-photo', (string) (int) $order->id, 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_photo_busy', __( 'Another photo update is already in progress. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		try {
			$photo_table = $this->db->table( 'vehicle_photos' );
			$existing    = $this->vehicle_photo_row_for_order( (int) $order->id );
			$maximum_retained = max( 1, (int) apply_filters( 'avenra_halo_v2_vehicle_photo_account_max_count', 20, $customer_id ) );
			$account_count    = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM `' . esc_sql( $photo_table ) . '` WHERE customer_id = %d', $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( $account_count >= $maximum_retained && ( ! $existing || (int) $existing->customer_id !== $customer_id ) ) {
				return Avenra_Halo_V2_Response::error( 'vehicle_photo_quota_exceeded', __( 'Your retained vehicle-photo limit has been reached. Contact Avenrà support if another vehicle needs a photo.', 'avenra-halo-v2' ), 409, array( 'max_photos' => $maximum_retained ) );
			}

			$uploads = wp_upload_dir();
			if ( ! empty( $uploads['error'] ) ) {
				return Avenra_Halo_V2_Response::error( 'vehicle_photo_storage_unavailable', __( 'Secure vehicle-photo storage is unavailable.', 'avenra-halo-v2' ), 503 );
			}
			$root       = trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private';
			$folder     = 'vehicle-' . $customer_id . '/' . (int) $order->id;
			$target_dir = trailingslashit( $root ) . $folder;
			if ( ! wp_mkdir_p( $target_dir ) ) {
				return Avenra_Halo_V2_Response::error( 'vehicle_photo_storage_unavailable', __( 'Secure vehicle-photo storage is unavailable.', 'avenra-halo-v2' ), 503 );
			}
			$mime_extensions = array( 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp' );
			$extension       = sanitize_key( (string) ( $checked['ext'] ?? $mime_extensions[ $checked['type'] ] ?? '' ) );
			if ( ! in_array( $extension, array( 'jpg', 'jpeg', 'png', 'webp' ), true ) ) {
				return Avenra_Halo_V2_Response::error( 'photo_type_not_allowed', __( 'Upload a JPG, PNG or WebP image.', 'avenra-halo-v2' ), 415 );
			}
			$filename    = Avenra_Halo_V2_Auth::random_token( 24 ) . '.' . $extension;
			$target      = trailingslashit( $target_dir ) . $filename;
			$storage_key = $folder . '/' . $filename;
			if ( ! move_uploaded_file( (string) $file['tmp_name'], $target ) ) {
				return Avenra_Halo_V2_Response::error( 'photo_upload_failed', __( 'The vehicle photo could not be stored.', 'avenra-halo-v2' ), 500 );
			}
			@chmod( $target, 0640 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod

			$now        = current_time( 'mysql', true );
			$photo_data = array(
				'customer_id'       => $customer_id,
				'vehicle_order_id'  => (int) $order->id,
				'storage_key'       => $storage_key,
				'mime_type'         => (string) $checked['type'],
				'original_filename' => sanitize_file_name( (string) $file['name'] ),
				'file_size'         => (int) $file['size'],
				'updated_at'        => $now,
			);
			if ( $existing ) {
				$stored = $wpdb->update( $photo_table, $photo_data, array( 'id' => (int) $existing->id, 'vehicle_order_id' => (int) $order->id ) );
			} else {
				$photo_data['created_at'] = $now;
				$stored                   = $wpdb->insert( $photo_table, $photo_data );
			}
			if ( false === $stored ) {
				@unlink( $target ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
				return Avenra_Halo_V2_Response::error( 'photo_update_failed', __( 'The vehicle photo could not be attached to your vehicle.', 'avenra-halo-v2' ), 500 );
			}

			$old_path = $existing ? $this->private_vehicle_photo_path( (string) $existing->storage_key ) : null;
			if ( $old_path && $old_path !== $target && ! @unlink( $old_path ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
				do_action( 'avenra_halo_v2_vehicle_photo_cleanup_error', $old_path, (int) $order->id, $customer_id );
			}

			// Early V2 previews stored photos as public Media Library attachments.
			// Remove only attachments carrying both V2 ownership markers; V1 images
			// and the legacy order columns otherwise remain untouched.
			$this->remove_legacy_public_vehicle_photos( $order, $customer_id );

			$order = $this->owned_order( (int) $order->id );
			return Avenra_Halo_V2_Response::success( $this->serialise_vehicle( $order ) );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function vehicle_photo( WP_REST_Request $request ): WP_REST_Response {
		$order = $this->owned_order( (int) $request['id'] );
		if ( ! $order ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_not_found', __( 'That vehicle is not attached to your account.', 'avenra-halo-v2' ), 404 );
		}
		$row  = $this->private_vehicle_photo_row( (int) $order->id );
		$path = $row ? $this->private_vehicle_photo_path( (string) $row->storage_key ) : null;
		if ( ! $row || ! $path ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_photo_not_found', __( 'That private vehicle photo is unavailable.', 'avenra-halo-v2' ), 404 );
		}

		return new WP_REST_Response(
			array(
				'_halo_private_file' => $path,
				'mime_type'          => (string) $row->mime_type,
				'filename'           => (string) $row->original_filename,
				'disposition'        => 'inline',
			),
			200
		);
	}

	public function rides( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$page   = max( 1, absint( $request->get_param( 'page' ) ?: 1 ) );
		$limit  = min( 100, max( 1, absint( $request->get_param( 'per_page' ) ?: 25 ) ) );
		$offset = ( $page - 1 ) * $limit;
		$table  = $this->db->table( 'rides' );
		$fetch_limit = min( 5000, $offset + $limit );
		$rows   = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $table ) . '` WHERE customer_id = %d ORDER BY started_at DESC, id DESC LIMIT %d', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$this->auth->customer_id(),
				$fetch_limit
			)
		);
		$legacy = $this->legacy_rides();
		$items  = array_merge( array_map( array( $this, 'serialise_ride' ), $rows ), $legacy );
		usort( $items, static fn( array $left, array $right ): int => strtotime( (string) ( $right['started_at'] ?? '' ) ) <=> strtotime( (string) ( $left['started_at'] ?? '' ) ) );
		$items  = array_slice( $items, $offset, $limit );
		$total  = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM `' . esc_sql( $table ) . '` WHERE customer_id = %d', $this->auth->customer_id() ) ) + count( $legacy ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared

		return Avenra_Halo_V2_Response::success(
			$items,
			200,
			array(
				'page'        => $page,
				'per_page'    => $limit,
				'total'       => $total,
				'total_pages' => (int) ceil( $total / $limit ),
				'summary'     => $this->ride_summary(),
			)
		);
	}

	public function ride( WP_REST_Request $request ): WP_REST_Response {
		$row = $this->owned_ride( (string) $request['id'] );
		if ( ! $row ) {
			$legacy = $this->legacy_ride( (string) $request['id'] );
			return $legacy
				? Avenra_Halo_V2_Response::success( $legacy )
				: Avenra_Halo_V2_Response::error( 'ride_not_found', __( 'That ride was not found.', 'avenra-halo-v2' ), 404 );
		}
		return Avenra_Halo_V2_Response::success( $this->serialise_ride( $row ) );
	}

	public function share_ride( WP_REST_Request $request ): WP_REST_Response {
		$row = $this->owned_ride( (string) $request['id'] );
		$ride = $row ? $this->serialise_ride( $row ) : $this->legacy_ride( (string) $request['id'] );
		if ( ! $ride ) {
			return Avenra_Halo_V2_Response::error( 'ride_not_found', __( 'That ride was not found.', 'avenra-halo-v2' ), 404 );
		}
		$max_lean = round( (float) $ride['max_lean_degrees'] );
		$route_url = $this->ride_route_share_url( $ride );
		$text = sprintf(
			/* translators: 1: miles, 2: speed, 3: lean angle */
			__( 'I recorded %1$s miles with Avenrà Halo. Top speed %2$s mph; maximum lean %3$s°.', 'avenra-halo-v2' ),
			number_format_i18n( (float) $ride['distance_miles'], 1 ),
			number_format_i18n( (float) $ride['top_speed_mph'], 0 ),
			number_format_i18n( $max_lean, 0 )
		);
		if ( $route_url ) {
			$text .= "\n\n" . __( 'Check out my route:', 'avenra-halo-v2' ) . "\n" . $route_url;
		}
		$url = $route_url ?: Avenra_Halo_V2_Plugin::page_url();
		return Avenra_Halo_V2_Response::success(
			array(
				'title'     => __( 'My Avenrà ride', 'avenra-halo-v2' ),
				'text'      => $text,
				'url'       => $url,
				'route_url' => $route_url,
				'map_url'   => $route_url,
			)
		);
	}

	public function save_ride( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body      = $this->body( $request );
		$summary   = is_array( $body['summary'] ?? null ) ? $body['summary'] : array();
		$metrics   = is_array( $summary['metrics'] ?? null ) ? $summary['metrics'] : array();
		$flat      = array_merge( $summary, $metrics, $body );
		$client_id = sanitize_text_field( (string) ( $body['client_ride_id'] ?? $body['ride_id'] ?? $summary['id'] ?? '' ) );
		if ( '' !== $client_id && ! preg_match( '/^[A-Za-z0-9._:-]{8,64}$/', $client_id ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_client_ride_id', __( 'The local ride identifier was invalid.', 'avenra-halo-v2' ), 422 );
		}

		$table = $this->db->table( 'rides' );
		if ( '' !== $client_id ) {
			$existing = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $table ) . '` WHERE customer_id = %d AND client_ride_id = %s LIMIT 1', $this->auth->customer_id(), $client_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( $existing ) {
				return Avenra_Halo_V2_Response::success( $this->serialise_ride( $existing ), 200, array( 'idempotent' => true ) );
			}
		}

		$vehicle_id = absint( $flat['vehicle_order_id'] ?? $flat['vehicle_id'] ?? $summary['context']['vehicleId'] ?? 0 );
		if ( $vehicle_id && ! $this->db->order_belongs_to_customer( $vehicle_id, $this->auth->customer_id() ) ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_not_found', __( 'That vehicle is not attached to your account.', 'avenra-halo-v2' ), 404 );
		}

		$duration  = min( 7 * DAY_IN_SECONDS, max( 0, absint( $flat['duration_seconds'] ?? $flat['duration_secs'] ?? $flat['durationSeconds'] ?? 0 ) ) );
		$started   = $this->normalise_datetime( (string) ( $flat['started_at'] ?? $flat['startedAt'] ?? $flat['ride_date'] ?? '' ) ) ?: gmdate( 'Y-m-d H:i:s', time() - $duration );
		$ended     = $this->normalise_datetime( (string) ( $flat['ended_at'] ?? $flat['endedAt'] ?? '' ) ) ?: gmdate( 'Y-m-d H:i:s', strtotime( $started . ' UTC' ) + $duration );
		$route_input = $summary['points'] ?? $flat['points'] ?? $body['route_coordinates'] ?? $body['route_json'] ?? $body['route'] ?? array();
		$route     = $this->normalise_route( $route_input );
		$telemetry = $this->safe_json_value( $summary ?: ( $body['telemetry'] ?? array() ), 250000 );
		$first_point = $route ? $route[0] : array();
		$last_point  = $route ? $route[ count( $route ) - 1 ] : array();
		$energy_wh   = $flat['energy_wh'] ?? null;
		if ( null === $energy_wh && isset( $flat['energy_kwh'] ) && is_numeric( $flat['energy_kwh'] ) ) {
			$energy_wh = (float) $flat['energy_kwh'] * 1000;
		}
		$ride_context = is_array( $flat['context'] ?? null ) ? $flat['context'] : array();
		$ride_mode = substr( sanitize_key( (string) ( $flat['ride_mode'] ?? $flat['rideMode'] ?? $ride_context['rideMode'] ?? $ride_context['mode'] ?? '' ) ), 0, 24 );
		$telemetry_quality = sanitize_key( (string) ( $flat['telemetry_quality'] ?? $flat['telemetryQuality'] ?? '' ) );
		if ( ! in_array( $telemetry_quality, array( 'high', 'medium', 'gps-only', 'limited', 'unavailable' ), true ) ) {
			$telemetry_quality = '';
		}

		$data = array(
			'public_id'          => wp_generate_uuid4(),
			'customer_id'        => $this->auth->customer_id(),
			'vehicle_order_id'   => $vehicle_id ?: null,
			'client_ride_id'     => '' !== $client_id ? $client_id : null,
			'started_at'         => $started,
			'ended_at'           => $ended,
			'duration_seconds'   => $duration,
			'distance_miles'     => $this->number( $flat['distance_miles'] ?? $flat['distanceMiles'] ?? 0, 0, 5000, 0 ),
			'energy_wh'          => $this->number( $energy_wh, 0, 500000, null ),
			'average_speed_mph'  => $this->number( $flat['average_speed_mph'] ?? $flat['averageSpeedMph'] ?? null, 0, 250, null ),
			'top_speed_mph'      => $this->number( $flat['top_speed_mph'] ?? $flat['topSpeedMph'] ?? $flat['top_speed'] ?? 0, 0, 250, 0 ),
			'best_zero_to_sixty' => $this->nullable_performance( $flat['best_zero_to_sixty'] ?? $flat['bestZeroToSixty'] ?? $flat['best_0_60'] ?? null ),
			'max_lean_left'      => $this->number( $flat['max_lean_left'] ?? $flat['maxLeanLeft'] ?? 0, 0, 90, 0 ),
			'max_lean_right'     => $this->number( $flat['max_lean_right'] ?? $flat['maxLeanRight'] ?? 0, 0, 90, 0 ),
			'start_lat'          => $this->coordinate( $flat['start_lat'] ?? $first_point[1] ?? null, -90, 90 ),
			'start_lng'          => $this->coordinate( $flat['start_lng'] ?? $first_point[0] ?? null, -180, 180 ),
			'end_lat'            => $this->coordinate( $flat['end_lat'] ?? $last_point[1] ?? null, -90, 90 ),
			'end_lng'            => $this->coordinate( $flat['end_lng'] ?? $last_point[0] ?? null, -180, 180 ),
			'start_location'     => $this->text_substr( sanitize_text_field( (string) ( $flat['start_location'] ?? '' ) ), 0, 255 ),
			'end_location'       => $this->text_substr( sanitize_text_field( (string) ( $flat['end_location'] ?? '' ) ), 0, 255 ),
			'route_json'         => wp_json_encode( $route ),
			'telemetry_json'     => wp_json_encode( $telemetry ),
			'ride_mode'          => '' !== $ride_mode ? $ride_mode : null,
			'peak_g_force'       => $this->number( $flat['peak_g_force'] ?? $flat['peakGForce'] ?? null, 0, 30, null ),
			'harsh_event_count'  => min( 10000, absint( $flat['harsh_event_count'] ?? $flat['harshEventCount'] ?? 0 ) ),
			'telemetry_quality'  => '' !== $telemetry_quality ? $telemetry_quality : null,
			'status'             => 'complete',
			'created_at'         => current_time( 'mysql', true ),
			'updated_at'         => current_time( 'mysql', true ),
		);

		if ( ! $wpdb->insert( $table, $this->db->supported_data( $table, $data ) ) ) {
			return Avenra_Halo_V2_Response::error( 'ride_save_failed', __( 'The ride remains safe on this device but could not sync yet.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}

		$ride_id = (int) $wpdb->insert_id;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $table ) . '` WHERE id = %d', $ride_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		do_action( 'avenra_halo_v2_ride_saved', $ride_id, $this->auth->customer_id() );
		if ( ! is_object( $row ) ) {
			return Avenra_Halo_V2_Response::error(
				'ride_read_failed',
				__( 'The ride was saved but could not be confirmed. Refresh your ride history before trying again.', 'avenra-halo-v2' ),
				503,
				array( 'saved' => true, 'retryable' => true )
			);
		}
		return Avenra_Halo_V2_Response::success( $this->serialise_ride( $row ), 201 );
	}

	public function hazards( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$table  = $this->db->table( 'hazards' );
		$params = array( current_time( 'mysql', true ) );
		$where  = "status = 'active' AND (expires_at IS NULL OR expires_at > %s)";
		$bounds = array(
			$this->coordinate( $request->get_param( 'south' ) ?? $request->get_param( 's' ), -90, 90 ),
			$this->coordinate( $request->get_param( 'west' ) ?? $request->get_param( 'w' ), -180, 180 ),
			$this->coordinate( $request->get_param( 'north' ) ?? $request->get_param( 'n' ), -90, 90 ),
			$this->coordinate( $request->get_param( 'east' ) ?? $request->get_param( 'e' ), -180, 180 ),
		);
		if ( ! in_array( null, $bounds, true ) && $bounds[0] <= $bounds[2] ) {
			$where   .= ' AND latitude BETWEEN %f AND %f AND longitude BETWEEN %f AND %f';
			$params[] = $bounds[0];
			$params[] = $bounds[2];
			$params[] = $bounds[1];
			$params[] = $bounds[3];
		}

		$limit    = min( 250, max( 1, absint( $request->get_param( 'limit' ) ?: 100 ) ) );
		$params[] = $limit;
		$sql      = $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $table ) . '` WHERE ' . $where . ' ORDER BY reported_at DESC LIMIT %d', $params ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows     = $wpdb->get_results( $sql );
		$items    = array_map( array( $this, 'serialise_hazard' ), $rows );
		$focus    = array( 'available' => false, 'historical_zones' => array(), 'community_hazards' => array() );
		if ( ! in_array( null, $bounds, true ) ) {
			$focus = $this->load_focus_zones( array( 'south' => $bounds[0], 'west' => $bounds[1], 'north' => $bounds[2], 'east' => $bounds[3] ) );
			foreach ( $focus['community_hazards'] as $legacy_hazard ) {
				$duplicate = false;
				foreach ( $items as $item ) {
					if ( $item['type'] === $legacy_hazard['type'] && abs( $item['latitude'] - $legacy_hazard['latitude'] ) < 0.00001 && abs( $item['longitude'] - $legacy_hazard['longitude'] ) < 0.00001 ) {
						$duplicate = true;
						break;
					}
				}
				if ( ! $duplicate ) {
					$items[] = $legacy_hazard;
				}
			}
		}

		return Avenra_Halo_V2_Response::success(
			$items,
			200,
			array(
				'count'            => count( $items ),
				'focus_available'  => (bool) $focus['available'],
				'historical_zones' => $focus['historical_zones'],
			)
		);
	}

	public function focus_zones( WP_REST_Request $request ): WP_REST_Response {
		$bounds = array(
			'south' => $this->coordinate( $request->get_param( 'south' ) ?? $request->get_param( 's' ), -90, 90 ),
			'west'  => $this->coordinate( $request->get_param( 'west' ) ?? $request->get_param( 'w' ), -180, 180 ),
			'north' => $this->coordinate( $request->get_param( 'north' ) ?? $request->get_param( 'n' ), -90, 90 ),
			'east'  => $this->coordinate( $request->get_param( 'east' ) ?? $request->get_param( 'e' ), -180, 180 ),
		);
		if ( in_array( null, $bounds, true ) || $bounds['south'] > $bounds['north'] ) {
			return Avenra_Halo_V2_Response::error( 'invalid_bounds', __( 'A valid map viewport is required.', 'avenra-halo-v2' ), 422 );
		}
		return Avenra_Halo_V2_Response::success( $this->load_focus_zones( $bounds ) );
	}

	public function save_hazard( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		if ( ! $this->consume_rate_limit( 'hazard-account', (string) $this->auth->customer_id(), 30, HOUR_IN_SECONDS ) || ! $this->consume_rate_limit( 'hazard-ip', $this->request_ip(), 100, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'hazard_throttled', __( 'Please wait before reporting another road hazard.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		$body = $this->body( $request );
		$type = sanitize_text_field( (string) ( $body['hazard_type'] ?? $body['type'] ?? '' ) );
		$type_aliases = array( 'road' => 'Road Surface', 'traffic' => 'Stopped Traffic', 'closure' => 'Road Closure', 'other' => 'Other' );
		$type = $type_aliases[ strtolower( $type ) ] ?? $type;
		$allowed = (array) apply_filters(
			'avenra_halo_v2_hazard_types',
			array( 'Diesel Spill', 'Deep Pothole', 'Road Surface', 'Loose Gravel', 'Ice / Debris', 'Debris', 'Flooding', 'Roadworks', 'Road Closure', 'Stopped Traffic', 'Collision', 'Other' )
		);
		if ( ! in_array( $type, $allowed, true ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_hazard_type', __( 'Choose a valid hazard type.', 'avenra-halo-v2' ), 422 );
		}

		$position = is_array( $body['position'] ?? null ) ? $body['position'] : array();
		$lat = $this->coordinate( $body['lat'] ?? $body['latitude'] ?? $position['lat'] ?? $position['latitude'] ?? null, -90, 90 );
		$lng = $this->coordinate( $body['lng'] ?? $body['longitude'] ?? $position['lng'] ?? $position['longitude'] ?? null, -180, 180 );
		if ( null === $lat || null === $lng ) {
			return Avenra_Halo_V2_Response::error( 'invalid_location', __( 'A current GPS location is required to report a hazard.', 'avenra-halo-v2' ), 422 );
		}

		$ride_id = null;
		if ( ! empty( $body['ride_id'] ) || ! empty( $body['client_ride_id'] ) ) {
			$ride = $this->owned_ride( (string) ( $body['ride_id'] ?? $body['client_ride_id'] ) );
			$ride_id = $ride ? (int) $ride->id : null;
		}
		$ttl = max( HOUR_IN_SECONDS, (int) apply_filters( 'avenra_halo_v2_hazard_ttl', 48 * HOUR_IN_SECONDS, $type ) );
		$data = array(
			'public_id'      => wp_generate_uuid4(),
			'customer_id'    => $this->auth->customer_id(),
			'ride_id'        => $ride_id,
			'hazard_type'    => $type,
			'severity'       => min( 3, max( 1, absint( $body['severity'] ?? 2 ) ) ),
			'latitude'       => $lat,
			'longitude'      => $lng,
			'note'           => $this->text_substr( sanitize_text_field( (string) ( $body['note'] ?? '' ) ), 0, 280 ),
			'status'         => 'active',
			'reported_at'    => current_time( 'mysql', true ),
			'expires_at'     => gmdate( 'Y-m-d H:i:s', time() + $ttl ),
		);
		if ( ! $wpdb->insert( $this->db->table( 'hazards' ), $data ) ) {
			return Avenra_Halo_V2_Response::error( 'hazard_save_failed', __( 'The hazard could not be shared right now.', 'avenra-halo-v2' ), 503 );
		}

		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'hazards' ) ) . '` WHERE id = %d', (int) $wpdb->insert_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( ! is_object( $row ) ) {
			return Avenra_Halo_V2_Response::error(
				'hazard_read_failed',
				__( 'The hazard was shared but its saved record could not be confirmed. Refresh the map before reporting it again.', 'avenra-halo-v2' ),
				503,
				array( 'saved' => true, 'retryable' => false )
			);
		}
		return Avenra_Halo_V2_Response::success( $this->serialise_hazard( $row ), 201 );
	}

	public function create_live_tracking( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		if ( ! $this->consume_rate_limit( 'live-tracking-account', (string) $this->auth->customer_id(), 20, HOUR_IN_SECONDS ) || ! $this->consume_rate_limit( 'live-tracking-ip', $this->request_ip(), 60, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'live_tracking_throttled', __( 'Too many live-sharing links were requested. Please wait and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		$body       = $this->body( $request );
		$viewer     = Avenra_Halo_V2_Auth::random_token( 32 );
		$writer     = Avenra_Halo_V2_Auth::random_token( 32 );
		$public_id  = wp_generate_uuid4();
		$guardian_enabled = $this->boolean( $body['guardian_enabled'] ?? $body['guardian_recovery_enabled'] ?? false );
		$guardian   = $guardian_enabled ? Avenra_Halo_V2_Auth::random_token( 32 ) : '';
		$guardian_label = $guardian_enabled
			? $this->text_substr( trim( sanitize_text_field( (string) ( $body['guardian_label'] ?? '' ) ) ), 0, 80 )
			: '';
		$lifetime   = min( DAY_IN_SECONDS, max( 15 * MINUTE_IN_SECONDS, absint( $body['lifetime_seconds'] ?? 4 * HOUR_IN_SECONDS ) ) );
		$ride_id    = null;
		$ride_reference = null;
		$requested_ride = $body['ride_id'] ?? $request['id'] ?? '';
		if ( ! empty( $requested_ride ) ) {
			$ride = $this->owned_ride( (string) $requested_ride );
			if ( $ride ) {
				$ride_id = (int) $ride->id;
				$ride_reference = (string) $ride->public_id;
			} else {
				$legacy_ride = $this->legacy_ride( (string) $requested_ride );
				if ( ! $legacy_ride ) {
					return Avenra_Halo_V2_Response::error( 'ride_not_found', __( 'That ride is not attached to your account.', 'avenra-halo-v2' ), 404 );
				}
				// V1 rides have no compatible numeric key for the V2 tracking table;
				// retain an explicit reference in the response rather than silently
				// pretending the row was attached.
				$ride_reference = (string) $legacy_ride['id'];
			}
		}

		$tracking_lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) $this->auth->customer_id(), 2 );
		if ( ! $tracking_lock ) {
			return Avenra_Halo_V2_Response::error( 'live_tracking_busy', __( 'Another live-sharing link is being created. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
			// Permission callbacks execute before this lock. Revalidate the exact
			// opaque session here so a request queued behind logout cannot create a
			// new public tracking link after sign-out has completed.
			if ( ! $this->auth->current_session_is_active() ) {
				return Avenra_Halo_V2_Response::error( 'session_expired', __( 'Your secure Halo session has ended. Sign in again before sharing a location.', 'avenra-halo-v2' ), 401 );
			}
			$maximum_active = max( 1, (int) apply_filters( 'avenra_halo_v2_live_tracking_active_limit', 5, $this->auth->customer_id() ) );
			$active_count   = (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` WHERE customer_id = %d AND tracking_mode = %s AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$this->auth->customer_id(),
					'rider_share',
					current_time( 'mysql', true )
				)
			);
			if ( $active_count >= $maximum_active ) {
				return Avenra_Halo_V2_Response::error( 'live_tracking_limit_reached', __( 'End an existing live-sharing link before creating another.', 'avenra-halo-v2' ), 409, array( 'max_active' => $maximum_active ) );
			}

			$inserted = $wpdb->insert(
				$this->db->table( 'live_tracking' ),
				array(
					'public_id'          => $public_id,
					'customer_id'       => $this->auth->customer_id(),
					'ride_id'           => $ride_id,
					'tracking_mode'      => 'rider_share',
					'viewer_token_hash' => hash( 'sha256', $viewer ),
					'writer_token_hash' => hash( 'sha256', $writer ),
					'guardian_enabled'  => $guardian_enabled ? 1 : 0,
					'guardian_token_hash'=> $guardian_enabled ? hash( 'sha256', $guardian ) : null,
					'guardian_label'    => $guardian_label,
					'started_at'        => current_time( 'mysql', true ),
					'expires_at'        => gmdate( 'Y-m-d H:i:s', time() + $lifetime ),
				)
			);
			if ( ! $inserted ) {
				return Avenra_Halo_V2_Response::error( 'live_tracking_failed', __( 'Live sharing could not be started.', 'avenra-halo-v2' ), 503 );
			}

			$tracking_args = array( 'track' => rawurlencode( $viewer ) );
			if ( $guardian_enabled ) {
				$tracking_args['guardian'] = rawurlencode( $guardian );
			}
			$tracking_url = add_query_arg( $tracking_args, Avenra_Halo_V2_Plugin::page_url() );
			return Avenra_Halo_V2_Response::success(
				array(
					'session_id'     => $public_id,
					'public_id'      => $public_id,
					'viewer_token'   => $viewer,
					'writer_token'   => $writer,
					'guardian_enabled' => $guardian_enabled,
					'guardian_recovery_enabled' => $guardian_enabled,
					'guardian_token' => $guardian_enabled ? $guardian : null,
					'guardian_label' => $guardian_label,
					'guardian_recovery_endpoint' => $guardian_enabled ? rest_url( self::NS . '/live-tracking/' . rawurlencode( $viewer ) . '/recovery-request' ) : null,
					'tracking_url'   => $tracking_url,
					'share_url'      => $tracking_url,
					'url'            => $tracking_url,
					'text'           => __( 'Follow my latest location, mapped road and GPS ride speeds in Avenrà Halo.', 'avenra-halo-v2' ),
					'view_api_url'   => rest_url( self::NS . '/live-tracking/' . rawurlencode( $viewer ) ),
					'ride_reference' => $ride_reference,
					'ride_attached'  => null !== $ride_id,
					'expires_at'     => gmdate( DATE_RFC3339, time() + $lifetime ),
				),
				201
			);
		} finally {
			$this->db->release_advisory_lock( $tracking_lock );
		}
	}

	public function list_live_tracking( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$maximum_active = max( 1, (int) apply_filters( 'avenra_halo_v2_live_tracking_active_limit', 5, $this->auth->customer_id() ) );
		$rows           = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT id, public_id, ride_id, guardian_enabled, guardian_label, recovery_request_id, recovery_requested_at, recovery_acknowledged_at, recovery_resumed_at, recovery_notification_attempted_at, recovery_notified_at, started_at, expires_at, last_ping_at FROM `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` WHERE customer_id = %d AND tracking_mode = %s AND ended_at IS NULL AND expires_at > %s ORDER BY started_at DESC', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$this->auth->customer_id(),
				'rider_share',
				current_time( 'mysql', true )
			)
		);
		$sessions       = array_map(
			function ( object $row ): array {
				return array(
					'id'           => (int) $row->id,
					'session_id'   => (string) $row->public_id,
					'public_id'    => (string) $row->public_id,
					'ride_id'      => null !== $row->ride_id ? (int) $row->ride_id : null,
					'guardian_enabled' => ! empty( $row->guardian_enabled ),
					'guardian_recovery_enabled' => ! empty( $row->guardian_enabled ),
					'guardian_label' => sanitize_text_field( (string) $row->guardian_label ),
					'recovery'     => Avenra_Halo_V2_Guardian::instance()->serialise_recovery( $row ),
					'started_at'   => $this->rfc3339( $row->started_at ),
					'expires_at'   => $this->rfc3339( $row->expires_at ),
					'last_ping_at' => $this->rfc3339( $row->last_ping_at ),
				);
			},
			$rows
		);

		return Avenra_Halo_V2_Response::success(
			array(
				'sessions'   => $sessions,
				'count'      => count( $sessions ),
				'max_active' => $maximum_active,
				'can_create' => count( $sessions ) < $maximum_active,
			)
		);
	}

	public function end_all_live_tracking( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$tracking_lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) $this->auth->customer_id(), 2 );
		if ( ! $tracking_lock ) {
			return Avenra_Halo_V2_Response::error( 'live_tracking_busy', __( 'A live-sharing link is being changed. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
			$ended = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE customer_id = %d AND tracking_mode = %s AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					$this->auth->customer_id(),
					'rider_share',
					current_time( 'mysql', true )
				)
			);

			if ( false === $ended ) {
				return Avenra_Halo_V2_Response::error( 'live_tracking_revoke_failed', __( 'Live-sharing links could not be ended right now.', 'avenra-halo-v2' ), 503 );
			}

			return Avenra_Halo_V2_Response::success( array( 'ended' => true, 'count' => (int) $ended ) );
		} finally {
			$this->db->release_advisory_lock( $tracking_lock );
		}
	}

	public function view_live_tracking( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` WHERE viewer_token_hash = %s AND tracking_mode = %s LIMIT 1', hash( 'sha256', (string) $request['token'] ), 'rider_share' ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( ! $row || $row->ended_at || strtotime( (string) $row->expires_at . ' UTC' ) <= time() ) {
			return Avenra_Halo_V2_Response::error( 'tracking_not_found', __( 'This live tracking link is no longer available.', 'avenra-halo-v2' ), 404 );
		}

		$has_ping = ! empty( $row->last_ping_at );
		$stale_after = Avenra_Halo_V2_Guardian::instance()->stale_after_seconds();
		$activity_time = strtotime( (string) ( $has_ping ? $row->last_ping_at : $row->started_at ) . ' UTC' );
		$is_stale = false !== $activity_time && $activity_time <= time() - $stale_after;
		$status   = $is_stale ? 'stale' : ( $has_ping ? 'active' : 'waiting' );
		$guardian_token = trim( (string) $request->get_header( 'X-Halo-Guardian' ) );
		$guardian_authorised = ! empty( $row->guardian_enabled )
			&& strlen( $guardian_token ) >= 40
			&& ! empty( $row->guardian_token_hash )
			&& hash_equals( (string) $row->guardian_token_hash, hash( 'sha256', $guardian_token ) );
		$payload = array(
				'status'       => $status,
				'latitude'     => null !== $row->latitude ? (float) $row->latitude : null,
				'longitude'    => null !== $row->longitude ? (float) $row->longitude : null,
				'speed_mph'    => $has_ping ? (float) $row->speed_mph : null,
				'top_speed_mph' => $has_ping ? (float) $row->top_speed_mph : null,
				'road_name'    => $has_ping && '' !== trim( (string) $row->road_name ) ? (string) $row->road_name : null,
				'heading'      => null !== $row->heading ? (float) $row->heading : null,
				'accuracy_m'   => null !== $row->accuracy_m ? (float) $row->accuracy_m : null,
				'last_ping_at' => $this->rfc3339( $row->last_ping_at ),
				'started_at'   => $this->rfc3339( $row->started_at ),
				'ended_at'     => $this->rfc3339( $row->ended_at ),
				'expires_at'   => $this->rfc3339( $row->expires_at ),
				'guardian_enabled' => ! empty( $row->guardian_enabled ),
				'guardian_recovery_enabled' => ! empty( $row->guardian_enabled ),
			);
		if ( $guardian_authorised ) {
			$payload['recovery'] = Avenra_Halo_V2_Guardian::instance()->serialise_public_recovery( $row );
		}
		return Avenra_Halo_V2_Response::success( $payload );
	}

	public function update_live_tracking( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body     = $this->body( $request );
		$writer   = trim( (string) ( $request->get_header( 'X-Halo-Writer' ) ?: ( $body['writer_token'] ?? '' ) ) );
		$sequence = max( 1, absint( $body['sequence'] ?? 1 ) );
		$lat      = $this->coordinate( $body['lat'] ?? $body['latitude'] ?? null, -90, 90 );
		$lng      = $this->coordinate( $body['lng'] ?? $body['longitude'] ?? null, -180, 180 );
		if ( strlen( $writer ) < 40 || null === $lat || null === $lng ) {
			return Avenra_Halo_V2_Response::error( 'invalid_tracking_update', __( 'The live location update was incomplete.', 'avenra-halo-v2' ), 422 );
		}

		$table       = $this->db->table( 'live_tracking' );
		$viewer_hash = hash( 'sha256', (string) $request['token'] );
		$writer_hash = hash( 'sha256', $writer );
		$lock_row    = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT public_id, guardian_enabled, recovery_requested_at, recovery_resumed_at FROM `' . esc_sql( $table ) . '` WHERE viewer_token_hash = %s AND writer_token_hash = %s AND tracking_mode = %s AND ended_at IS NULL LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$viewer_hash,
				$writer_hash,
				'rider_share'
			)
		);
		$speed       = (float) $this->number( $body['speed_mph'] ?? $body['speed'] ?? 0, 0, 250, 0 );
		$top_speed   = max( $speed, (float) $this->number( $body['top_speed_mph'] ?? $body['top_speed'] ?? 0, 0, 250, 0 ) );
		$road_name   = $this->text_substr( trim( sanitize_text_field( (string) ( $body['road_name'] ?? '' ) ) ), 0, 190 );
		$now         = current_time( 'mysql', true );
		$sql         = $wpdb->prepare(
			"UPDATE `" . esc_sql( $table ) . "` SET last_sequence = %d, latitude = %f, longitude = %f, speed_mph = %f, top_speed_mph = GREATEST(top_speed_mph, %f), road_name = NULLIF(%s, ''), heading = NULLIF(%s, ''), accuracy_m = NULLIF(%s, ''), last_ping_at = %s, recovery_acknowledged_at = IF(recovery_requested_at IS NOT NULL AND (recovery_resumed_at IS NULL OR recovery_resumed_at < recovery_requested_at), COALESCE(recovery_acknowledged_at, %s), recovery_acknowledged_at), recovery_resumed_at = IF(recovery_requested_at IS NOT NULL AND (recovery_resumed_at IS NULL OR recovery_resumed_at < recovery_requested_at), %s, recovery_resumed_at) WHERE viewer_token_hash = %s AND writer_token_hash = %s AND tracking_mode = %s AND ended_at IS NULL AND expires_at > %s AND last_sequence < %d", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$sequence,
			$lat,
			$lng,
			$speed,
			$top_speed,
			$road_name,
			$this->nullable_sql_number( $body['heading'] ?? null, 0, 360 ),
			$this->nullable_sql_number( $body['accuracy_m'] ?? null, 0, 10000 ),
			$now,
			$now,
			$now,
			$viewer_hash,
			$writer_hash,
			'rider_share',
			current_time( 'mysql', true ),
			$sequence
		);
		$notification_lock = null;
		$requested_at = is_object( $lock_row ) && ! empty( $lock_row->recovery_requested_at ) ? strtotime( (string) $lock_row->recovery_requested_at . ' UTC' ) : false;
		$resumed_at   = is_object( $lock_row ) && ! empty( $lock_row->recovery_resumed_at ) ? strtotime( (string) $lock_row->recovery_resumed_at . ' UTC' ) : false;
		if ( is_object( $lock_row ) && ! empty( $lock_row->guardian_enabled ) && ! empty( $lock_row->public_id ) && false !== $requested_at && ( false === $resumed_at || $resumed_at < $requested_at ) ) {
			$notification_lock = $this->db->acquire_advisory_lock( 'guardian-notification', (string) $lock_row->public_id, 2 );
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
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT ended_at, expires_at, last_sequence FROM `' . esc_sql( $table ) . '` WHERE viewer_token_hash = %s AND writer_token_hash = %s AND tracking_mode = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$viewer_hash,
					$writer_hash,
					'rider_share'
				)
			);
			if ( ! $row ) {
				return Avenra_Halo_V2_Response::error( 'tracking_not_found', __( 'This live-sharing session is no longer available.', 'avenra-halo-v2' ), 404 );
			}
			if ( $row->ended_at || strtotime( (string) $row->expires_at . ' UTC' ) <= time() ) {
				return Avenra_Halo_V2_Response::error( 'tracking_ended', __( 'This live-sharing session has ended.', 'avenra-halo-v2' ), 410 );
			}
			return Avenra_Halo_V2_Response::error(
				'tracking_update_rejected',
				__( 'A newer location update was already accepted.', 'avenra-halo-v2' ),
				409,
				array( 'last_sequence' => (int) $row->last_sequence )
			);
		}

		return Avenra_Halo_V2_Response::success( array( 'accepted' => true, 'sequence' => $sequence ) );
	}

	public function end_live_tracking( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$updated = $wpdb->query(
			$wpdb->prepare(
				'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE viewer_token_hash = %s AND customer_id = %d AND tracking_mode = %s AND ended_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				current_time( 'mysql', true ),
				hash( 'sha256', (string) $request['token'] ),
				$this->auth->customer_id(),
				'rider_share'
			)
		);
		if ( false === $updated ) {
			return Avenra_Halo_V2_Response::error( 'tracking_revoke_failed', __( 'Halo could not end this live-sharing link right now.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( 0 === $updated ) {
			return Avenra_Halo_V2_Response::error( 'tracking_not_found', __( 'That live sharing session was not found.', 'avenra-halo-v2' ), 404 );
		}
		return Avenra_Halo_V2_Response::success( array( 'ended' => true ) );
	}

	/** Consume a short-lived rider arm and create one staff-only ride monitor. */
	public function start_test_ride_monitoring( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$body           = $this->body( $request );
		$customer_id    = (int) $this->auth->customer_id();
		$auth_session   = $this->auth->session();
		$client_ride_id = sanitize_text_field( (string) ( $body['client_ride_id'] ?? $body['ride_id'] ?? '' ) );
		if ( $customer_id < 1 || ! is_object( $auth_session ) ) {
			return Avenra_Halo_V2_Response::error( 'authentication_required', __( 'Sign in before starting test-ride monitoring.', 'avenra-halo-v2' ), 401 );
		}
		if ( ! preg_match( '/^[A-Za-z0-9._:-]{8,80}$/', $client_ride_id ) ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_ride_id_invalid', __( 'A stable ride identifier is required for test-ride monitoring.', 'avenra-halo-v2' ), 422 );
		}
		if ( ! $this->test_ride_monitoring_schema_ready() ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_unavailable', __( 'Test-ride monitoring needs the latest Halo database update.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( ! $this->consume_rate_limit( 'test-ride-monitoring-start', (string) $customer_id, 20, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_throttled', __( 'Please wait before starting another monitored test ride.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 60 ) );
		}

		$lock = $this->db->acquire_advisory_lock( 'test-ride-monitoring', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_busy', __( 'Test-ride monitoring is already being updated.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
			if ( ! $this->auth->current_session_is_active() ) {
				return Avenra_Halo_V2_Response::error( 'session_expired', __( 'Your secure Halo session has ended. Sign in again before starting monitoring.', 'avenra-halo-v2' ), 401 );
			}
			$auth_session = $this->auth->session();
			if ( ! is_object( $auth_session ) ) {
				return Avenra_Halo_V2_Response::error( 'session_expired', __( 'Your secure Halo session has ended. Sign in again before starting monitoring.', 'avenra-halo-v2' ), 401 );
			}

			if ( false === $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_transaction_failed', __( 'Halo could not start a protected monitoring session.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$tracking_table = $this->db->table( 'live_tracking' );
			$settings_table = $this->db->table( 'emergency_settings' );
			$now = current_time( 'mysql', true );
			$existing = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM `' . esc_sql( $tracking_table ) . '` WHERE customer_id = %d AND client_ride_id = %s AND tracking_mode = %s LIMIT 1 FOR UPDATE', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id,
					$client_ride_id,
					'test_ride'
				)
			);
			if ( is_object( $existing ) ) {
				$same_session = (int) $existing->auth_session_id === (int) $auth_session->id;
				$active = empty( $existing->ended_at ) && strtotime( (string) $existing->expires_at . ' UTC' ) > time();
				if ( $same_session && $active ) {
					if ( false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
						$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
						return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_commit_failed', __( 'Halo could not confirm the monitoring session.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
					}
					return Avenra_Halo_V2_Response::success( $this->test_ride_monitoring_payload( $existing ) );
				}
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_ride_already_used', __( 'This ride identifier already belongs to a monitoring session.', 'avenra-halo-v2' ), 409, array( 'retryable' => false ) );
			}

			$settings = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT test_ride_monitoring_armed, test_ride_monitoring_arm_id, test_ride_monitoring_consent_version, test_ride_monitoring_consented_at, test_ride_monitoring_armed_until FROM `' . esc_sql( $settings_table ) . '` WHERE customer_id = %d LIMIT 1 FOR UPDATE', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id
				)
			);
			$required_version = Avenra_Halo_V2_Emergency::instance()->required_test_ride_monitoring_consent_version();
			$armed_until = is_object( $settings ) && ! empty( $settings->test_ride_monitoring_armed_until )
				? strtotime( (string) $settings->test_ride_monitoring_armed_until . ' UTC' )
				: false;
			$valid_arm = is_object( $settings )
				&& '1' === (string) $settings->test_ride_monitoring_armed
				&& hash_equals( $required_version, (string) $settings->test_ride_monitoring_consent_version )
				&& ! empty( $settings->test_ride_monitoring_consented_at )
				&& false !== $armed_until
				&& $armed_until > time();
			if ( ! $valid_arm ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_not_armed', __( 'Enable and consent to one monitored test ride before starting the ride.', 'avenra-halo-v2' ), 409, array( 'retryable' => false, 'required_consent_version' => $required_version ) );
			}

			$consumed = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $settings_table ) . '` SET test_ride_monitoring_armed = 0, test_ride_monitoring_armed_until = NULL, updated_at = %s WHERE customer_id = %d AND test_ride_monitoring_armed = 1 AND test_ride_monitoring_consent_version = %s AND test_ride_monitoring_armed_until > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$now,
					$customer_id,
					$required_version,
					$now
				)
			);
			if ( 1 !== (int) $consumed ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_not_armed', __( 'This one-ride monitoring permission is no longer available.', 'avenra-halo-v2' ), 409, array( 'retryable' => false ) );
			}

			try {
				$viewer_secret = Avenra_Halo_V2_Auth::random_token( 32 );
				$writer_secret = Avenra_Halo_V2_Auth::random_token( 32 );
			} catch ( Throwable $error ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_token_failed', __( 'Halo could not create a secure monitoring session.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			$public_id = wp_generate_uuid4();
			$expires   = gmdate( 'Y-m-d H:i:s', time() + 4 * HOUR_IN_SECONDS );
			$created   = $wpdb->insert(
				$tracking_table,
				array(
					'public_id'          => $public_id,
					'customer_id'        => $customer_id,
					'tracking_mode'      => 'test_ride',
					'auth_session_id'    => (int) $auth_session->id,
					'client_ride_id'     => $client_ride_id,
					'arm_id'             => '' !== (string) $settings->test_ride_monitoring_arm_id ? (string) $settings->test_ride_monitoring_arm_id : null,
					'consent_version'    => $required_version,
					'consented_at'       => (string) $settings->test_ride_monitoring_consented_at,
					'viewer_token_hash'  => hash( 'sha256', $viewer_secret ),
					'writer_token_hash'  => hash( 'sha256', $writer_secret ),
					'guardian_enabled'   => 0,
					'started_at'         => $now,
					'expires_at'         => $expires,
					'last_sequence'      => 0,
				)
			);
			unset( $viewer_secret, $writer_secret );
			if ( false === $created ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_create_failed', __( 'Halo could not start test-ride monitoring.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			if ( false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_commit_failed', __( 'Halo could not confirm the monitoring session.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}

			return Avenra_Halo_V2_Response::success(
				$this->test_ride_monitoring_payload( (object) array( 'public_id' => $public_id, 'expires_at' => $expires, 'ended_at' => null ) ),
				201
			);
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	/** Accept an ordered, authenticated location for the current one-ride monitor. */
	public function update_test_ride_monitoring( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$session_id  = strtolower( sanitize_text_field( (string) $request['session_id'] ) );
		$customer_id = (int) $this->auth->customer_id();
		$auth_session = $this->auth->session();
		$body = $this->body( $request );
		$location = is_array( $body['location'] ?? null ) ? $body['location'] : $body;
		$sequence_value = $body['sequence'] ?? $location['sequence'] ?? null;
		$sequence = is_numeric( $sequence_value ) ? (int) $sequence_value : 0;
		$lat = $this->coordinate( $location['latitude'] ?? $location['lat'] ?? null, -90, 90 );
		$lng = $this->coordinate( $location['longitude'] ?? $location['lng'] ?? $location['lon'] ?? null, -180, 180 );
		if ( $customer_id < 1 || ! is_object( $auth_session ) || ! $this->auth->current_session_is_active() ) {
			return Avenra_Halo_V2_Response::error( 'session_expired', __( 'Your secure Halo session has ended.', 'avenra-halo-v2' ), 401 );
		}
		$auth_session = $this->auth->session();
		if ( ! is_object( $auth_session ) ) {
			return Avenra_Halo_V2_Response::error( 'session_expired', __( 'Your secure Halo session has ended.', 'avenra-halo-v2' ), 401 );
		}
		if ( ! preg_match( '/^[a-f0-9-]{36}$/', $session_id ) || $sequence < 1 || null === $lat || null === $lng ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_position_invalid', __( 'The test-ride location update was incomplete.', 'avenra-halo-v2' ), 422 );
		}
		if ( ! $this->test_ride_monitoring_schema_ready() ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_unavailable', __( 'Test-ride monitoring needs the latest Halo database update.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( ! $this->consume_rate_limit( 'test-ride-monitoring-position', $customer_id . ':' . $session_id, 1800, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_position_throttled', __( 'Test-ride locations are arriving too quickly.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 2 ) );
		}

		// Browser/native ride producers already apply Halo's +15% GPS calibration.
		// Store their mph value directly so monitoring cannot apply it twice.
		$speed = (float) $this->number( $location['speed_mph'] ?? $location['speed'] ?? 0, 0, 250, 0 );
		$top_speed = max( $speed, (float) $this->number( $location['top_speed_mph'] ?? $location['top_speed'] ?? $speed, 0, 250, $speed ) );
		$road_name = $this->text_substr( trim( sanitize_text_field( (string) ( $location['road_name'] ?? '' ) ) ), 0, 190 );
		$now = current_time( 'mysql', true );
		$table = $this->db->table( 'live_tracking' );
		$updated = $wpdb->query(
			$wpdb->prepare(
				"UPDATE `" . esc_sql( $table ) . "` SET last_sequence = %d, latitude = %f, longitude = %f, speed_mph = %f, top_speed_mph = GREATEST(top_speed_mph, %f), road_name = NULLIF(%s, ''), heading = NULLIF(%s, ''), accuracy_m = NULLIF(%s, ''), last_ping_at = %s WHERE public_id = %s AND customer_id = %d AND auth_session_id = %d AND tracking_mode = %s AND ended_at IS NULL AND expires_at > %s AND last_sequence < %d", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$sequence,
				$lat,
				$lng,
				$speed,
				$top_speed,
				$road_name,
				$this->nullable_sql_number( $location['heading'] ?? null, 0, 360 ),
				$this->nullable_sql_number( $location['accuracy_m'] ?? $location['accuracy'] ?? null, 0, 10000 ),
				$now,
				$session_id,
				$customer_id,
				(int) $auth_session->id,
				'test_ride',
				$now,
				$sequence
			)
		);
		if ( false === $updated ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_position_failed', __( 'The test-ride location could not be saved.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}
		if ( 0 === $updated ) {
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT ended_at, expires_at, last_sequence FROM `' . esc_sql( $table ) . '` WHERE public_id = %s AND customer_id = %d AND auth_session_id = %d AND tracking_mode = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$session_id,
					$customer_id,
					(int) $auth_session->id,
					'test_ride'
				)
			);
			if ( ! is_object( $row ) ) {
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_not_found', __( 'This test-ride monitoring session was not found.', 'avenra-halo-v2' ), 404 );
			}
			if ( ! empty( $row->ended_at ) || strtotime( (string) $row->expires_at . ' UTC' ) <= time() ) {
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_ended', __( 'This test-ride monitoring session has ended.', 'avenra-halo-v2' ), 410 );
			}
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_position_stale', __( 'A newer test-ride location was already accepted.', 'avenra-halo-v2' ), 409, array( 'last_sequence' => (int) $row->last_sequence ) );
		}

		return Avenra_Halo_V2_Response::success( array( 'accepted' => true, 'sequence' => $sequence ) );
	}

	/** End only the test monitor owned by this exact authenticated device session. */
	public function end_test_ride_monitoring( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$session_id  = strtolower( sanitize_text_field( (string) $request['session_id'] ) );
		$customer_id = (int) $this->auth->customer_id();
		$auth_session = $this->auth->session();
		if ( $customer_id < 1 || ! is_object( $auth_session ) || ! $this->auth->current_session_is_active() ) {
			return Avenra_Halo_V2_Response::error( 'session_expired', __( 'Your secure Halo session has ended.', 'avenra-halo-v2' ), 401 );
		}
		$auth_session = $this->auth->session();
		if ( ! is_object( $auth_session ) || ! preg_match( '/^[a-f0-9-]{36}$/', $session_id ) ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_not_found', __( 'This test-ride monitoring session was not found.', 'avenra-halo-v2' ), 404 );
		}
		if ( ! $this->test_ride_monitoring_schema_ready() ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_unavailable', __( 'Test-ride monitoring needs the latest Halo database update.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
		}

		$lock = $this->db->acquire_advisory_lock( 'test-ride-monitoring', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_busy', __( 'Test-ride monitoring is already being updated.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
			if ( ! $this->auth->current_session_is_active() ) {
				return Avenra_Halo_V2_Response::error( 'session_expired', __( 'Your secure Halo session has ended.', 'avenra-halo-v2' ), 401 );
			}
			$table = $this->db->table( 'live_tracking' );
			$row = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT id, ended_at, expires_at FROM `' . esc_sql( $table ) . '` WHERE public_id = %s AND customer_id = %d AND auth_session_id = %d AND tracking_mode = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$session_id,
					$customer_id,
					(int) $auth_session->id,
					'test_ride'
				)
			);
			if ( ! is_object( $row ) ) {
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_not_found', __( 'This test-ride monitoring session was not found.', 'avenra-halo-v2' ), 404 );
			}
			if ( ! empty( $row->ended_at ) ) {
				return Avenra_Halo_V2_Response::success( array( 'ended' => true, 'already_ended' => true, 'session_id' => $session_id ) );
			}

			$expired = strtotime( (string) $row->expires_at . ' UTC' ) <= time();
			$now = current_time( 'mysql', true );
			$updated = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $table ) . '` SET ended_at = %s, ended_reason = %s WHERE id = %d AND ended_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$now,
					$expired ? 'expired' : 'rider_ended',
					(int) $row->id
				)
			);
			if ( false === $updated ) {
				return Avenra_Halo_V2_Response::error( 'test_ride_monitoring_end_failed', __( 'Halo could not end test-ride monitoring.', 'avenra-halo-v2' ), 503, array( 'retryable' => true ) );
			}
			return Avenra_Halo_V2_Response::success( array( 'ended' => true, 'already_ended' => $expired || 0 === $updated, 'session_id' => $session_id ) );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	private function test_ride_monitoring_schema_ready(): bool {
		$tables = array(
			$this->db->table( 'live_tracking' ) => array( 'public_id', 'customer_id', 'tracking_mode', 'auth_session_id', 'client_ride_id', 'arm_id', 'consent_version', 'consented_at', 'ended_reason', 'viewer_token_hash', 'writer_token_hash', 'guardian_enabled', 'started_at', 'expires_at', 'ended_at', 'last_sequence', 'latitude', 'longitude', 'speed_mph', 'top_speed_mph', 'road_name', 'heading', 'accuracy_m', 'last_ping_at' ),
			$this->db->table( 'emergency_settings' ) => array( 'test_ride_monitoring_armed', 'test_ride_monitoring_arm_id', 'test_ride_monitoring_consent_version', 'test_ride_monitoring_consented_at', 'test_ride_monitoring_armed_until' ),
		);
		foreach ( $tables as $table => $columns ) {
			if ( ! $this->db->table_exists( $table ) ) {
				return false;
			}
			foreach ( $columns as $column ) {
				if ( ! $this->db->has_column( $table, $column ) ) {
					return false;
				}
			}
		}
		return true;
	}

	/** @return array{session_id:string,status:string,expires_at:?string,staff_url:string} */
	private function test_ride_monitoring_payload( object $row ): array {
		$session_id = strtolower( sanitize_text_field( (string) ( $row->public_id ?? '' ) ) );
		return array(
			'session_id' => $session_id,
			'status'     => 'active',
			'expires_at' => $this->rfc3339( $row->expires_at ?? null ),
			'staff_url'  => esc_url_raw( add_query_arg( 'test_ride', rawurlencode( $session_id ), home_url( '/halo-emergency-assist/' ) ) ),
		);
	}

	public function documents( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM `" . esc_sql( $this->db->table( 'documents' ) ) . "` WHERE customer_id = %d AND status = 'active' ORDER BY created_at DESC, id DESC", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$this->auth->customer_id()
			)
		);
		return Avenra_Halo_V2_Response::success( array_map( array( $this, 'serialise_document' ), $rows ), 200, array( 'count' => count( $rows ) ) );
	}

	public function document( WP_REST_Request $request ): WP_REST_Response {
		$row = $this->owned_document( (string) $request['id'] );
		if ( ! $row ) {
			return Avenra_Halo_V2_Response::error( 'document_not_found', __( 'That document was not found.', 'avenra-halo-v2' ), 404 );
		}
		return Avenra_Halo_V2_Response::success( $this->serialise_document( $row ) );
	}

	public function upload_document( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		if ( ! $this->consume_rate_limit( 'document-upload-account', (string) $this->auth->customer_id(), 20, HOUR_IN_SECONDS ) || ! $this->consume_rate_limit( 'document-upload-ip', $this->request_ip(), 60, HOUR_IN_SECONDS ) ) {
			return Avenra_Halo_V2_Response::error( 'document_upload_throttled', __( 'Too many documents were submitted. Please wait and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => HOUR_IN_SECONDS ) );
		}
		$files = $request->get_file_params();
		$file  = $files['file'] ?? $files['document'] ?? null;
		if ( ! is_array( $file ) || empty( $file['tmp_name'] ) || UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
			return Avenra_Halo_V2_Response::error( 'document_missing', __( 'Choose a document to upload.', 'avenra-halo-v2' ), 422 );
		}

		$max_size = (int) apply_filters( 'avenra_halo_v2_document_max_bytes', 10 * MB_IN_BYTES );
		if ( (int) $file['size'] < 1 || (int) $file['size'] > $max_size ) {
			return Avenra_Halo_V2_Response::error( 'document_too_large', __( 'Documents must be no larger than 10 MB.', 'avenra-halo-v2' ), 413, array( 'max_bytes' => $max_size ) );
		}

		$document_lock = $this->db->acquire_advisory_lock( 'document-upload', (string) $this->auth->customer_id(), 2 );
		if ( ! $document_lock ) {
			return Avenra_Halo_V2_Response::error( 'document_upload_busy', __( 'Another Glovebox upload is being processed. Please try again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}
		try {
		$maximum_documents = max( 1, (int) apply_filters( 'avenra_halo_v2_document_account_max_count', 100, $this->auth->customer_id() ) );
		$maximum_bytes     = max( $max_size, (int) apply_filters( 'avenra_halo_v2_document_account_max_bytes', 250 * MB_IN_BYTES, $this->auth->customer_id() ) );
		$usage = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT COUNT(*) AS document_count, COALESCE(SUM(file_size), 0) AS total_bytes FROM `" . esc_sql( $this->db->table( 'documents' ) ) . "` WHERE customer_id = %d AND status = 'active'", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$this->auth->customer_id()
			)
		);
		$current_count = is_object( $usage ) ? (int) $usage->document_count : 0;
		$current_bytes = is_object( $usage ) ? (int) $usage->total_bytes : 0;
		if ( $current_count >= $maximum_documents || $current_bytes + (int) $file['size'] > $maximum_bytes ) {
			return Avenra_Halo_V2_Response::error(
				'document_quota_exceeded',
				__( 'Your secure Glovebox storage limit has been reached. Remove an old document or contact Avenrà support.', 'avenra-halo-v2' ),
				409,
				array( 'max_documents' => $maximum_documents, 'max_bytes' => $maximum_bytes )
			);
		}

		$allowed = (array) apply_filters(
			'avenra_halo_v2_document_mimes',
			array(
				'pdf'      => 'application/pdf',
				'jpg|jpeg' => 'image/jpeg',
				'png'      => 'image/png',
				'webp'     => 'image/webp',
			)
		);
		$checked = wp_check_filetype_and_ext( (string) $file['tmp_name'], (string) $file['name'], $allowed );
		if ( empty( $checked['type'] ) || ! in_array( $checked['type'], array_values( $allowed ), true ) ) {
			return Avenra_Halo_V2_Response::error( 'document_type_not_allowed', __( 'Upload a PDF, JPG, PNG or WebP document.', 'avenra-halo-v2' ), 415 );
		}

		$body       = $this->body( $request );
		$vehicle_id = absint( $body['vehicle_order_id'] ?? $body['vehicle_id'] ?? 0 );
		if ( $vehicle_id && ! $this->db->order_belongs_to_customer( $vehicle_id, $this->auth->customer_id() ) ) {
			return Avenra_Halo_V2_Response::error( 'vehicle_not_found', __( 'That vehicle is not attached to your account.', 'avenra-halo-v2' ), 404 );
		}

		$types = (array) apply_filters( 'avenra_halo_v2_document_types', array( 'v5c', 'coc', 'insurance', 'invoice', 'warranty', 'service', 'mot', 'other' ) );
		$type  = sanitize_key( (string) ( $body['document_type'] ?? 'other' ) );
		if ( ! in_array( $type, $types, true ) ) {
			$type = 'other';
		}

		$uploads = wp_upload_dir();
		if ( ! empty( $uploads['error'] ) ) {
			return Avenra_Halo_V2_Response::error( 'document_storage_unavailable', __( 'Secure document storage is unavailable.', 'avenra-halo-v2' ), 503 );
		}
		$folder = Avenra_Halo_V2_Auth::random_token( 18 );
		$root   = trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private';
		$target_dir = trailingslashit( $root ) . $folder;
		if ( ! wp_mkdir_p( $target_dir ) ) {
			return Avenra_Halo_V2_Response::error( 'document_storage_unavailable', __( 'Secure document storage is unavailable.', 'avenra-halo-v2' ), 503 );
		}

		$filename = wp_unique_filename( $target_dir, sanitize_file_name( (string) $file['name'] ) );
		$target   = trailingslashit( $target_dir ) . $filename;
		if ( ! move_uploaded_file( (string) $file['tmp_name'], $target ) ) {
			return Avenra_Halo_V2_Response::error( 'document_upload_failed', __( 'The document could not be stored.', 'avenra-halo-v2' ), 500 );
		}
		@chmod( $target, 0640 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_chmod

		$public_id = wp_generate_uuid4();
		$now       = current_time( 'mysql', true );
		$inserted  = $wpdb->insert(
			$this->db->table( 'documents' ),
			array(
				'public_id'          => $public_id,
				'customer_id'        => $this->auth->customer_id(),
				'vehicle_order_id'   => $vehicle_id ?: null,
				'document_type'      => $type,
				'title'              => $this->text_substr( sanitize_text_field( (string) ( $body['title'] ?? $body['label'] ?? pathinfo( $filename, PATHINFO_FILENAME ) ) ), 0, 190 ),
				'original_filename'  => sanitize_file_name( (string) $file['name'] ),
				'storage_key'        => $folder . '/' . $filename,
				'mime_type'          => $checked['type'],
				'file_size'          => (int) $file['size'],
				'status'             => 'active',
				'issued_at'          => $this->valid_date( (string) ( $body['issued_at'] ?? '' ) ),
				'expires_at'         => $this->valid_date( (string) ( $body['expires_at'] ?? '' ) ),
				'created_at'         => $now,
				'updated_at'         => $now,
			)
		);
		if ( ! $inserted ) {
			@unlink( $target ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
			return Avenra_Halo_V2_Response::error( 'document_upload_failed', __( 'The document could not be indexed.', 'avenra-halo-v2' ), 500 );
		}

		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'documents' ) ) . '` WHERE id = %d', (int) $wpdb->insert_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( ! is_object( $row ) ) {
			return Avenra_Halo_V2_Response::error(
				'document_read_failed',
				__( 'The document was stored but its saved record could not be confirmed. Refresh your Glovebox before uploading it again.', 'avenra-halo-v2' ),
				503,
				array( 'saved' => true, 'retryable' => false )
			);
		}
		return Avenra_Halo_V2_Response::success( $this->serialise_document( $row ), 201 );
		} finally {
			$this->db->release_advisory_lock( $document_lock );
		}
	}

	public function download_document( WP_REST_Request $request ): WP_REST_Response {
		$row = $this->owned_document( (string) $request['id'] );
		if ( ! $row ) {
			return Avenra_Halo_V2_Response::error( 'document_not_found', __( 'That document was not found.', 'avenra-halo-v2' ), 404 );
		}

		$path = $this->private_document_path( (string) $row->storage_key );
		if ( ! $path ) {
			return Avenra_Halo_V2_Response::error( 'document_file_missing', __( 'The document file is unavailable. Please contact Avenrà support.', 'avenra-halo-v2' ), 404 );
		}

		return new WP_REST_Response(
			array(
				'_halo_private_file' => $path,
				'mime_type'          => (string) $row->mime_type,
				'filename'           => (string) $row->original_filename,
			),
			200
		);
	}

	public function archive_document( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$row = $this->owned_document( (string) $request['id'] );
		if ( ! $row ) {
			return Avenra_Halo_V2_Response::error( 'document_not_found', __( 'That document was not found.', 'avenra-halo-v2' ), 404 );
		}
		$path = $this->private_document_path( (string) $row->storage_key );
		if ( $path && ! @unlink( $path ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
			return Avenra_Halo_V2_Response::error( 'document_delete_failed', __( 'The private document file could not be removed.', 'avenra-halo-v2' ), 500 );
		}
		if ( $path ) {
			@rmdir( dirname( $path ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
		}
		$updated = $wpdb->update(
			$this->db->table( 'documents' ),
			array( 'status' => 'archived', 'storage_key' => '', 'updated_at' => current_time( 'mysql', true ) ),
			array( 'id' => (int) $row->id, 'customer_id' => $this->auth->customer_id() )
		);
		if ( false === $updated ) {
			return Avenra_Halo_V2_Response::error( 'document_archive_failed', __( 'The file was removed, but its Glovebox record could not be archived. Refresh and try again.', 'avenra-halo-v2' ), 500 );
		}
		do_action( 'avenra_halo_v2_document_archived', (int) $row->id, $this->auth->customer_id() );
		return Avenra_Halo_V2_Response::success( array( 'archived' => true ) );
	}

	public function shop_catalog( WP_REST_Request $request ): WP_REST_Response {
		$products = $this->catalog_products();
		return Avenra_Halo_V2_Response::success(
			array( 'products' => $products, 'items' => $products ),
			200,
			array( 'count' => count( $products ) )
		);
	}

	public function get_cart( WP_REST_Request $request ): WP_REST_Response {
		return Avenra_Halo_V2_Response::success( array( 'cart' => $this->cart_state() ) );
	}

	public function add_cart_item( WP_REST_Request $request ): WP_REST_Response {
		$body       = $this->body( $request );
		$product_id = sanitize_text_field( (string) ( $body['product_id'] ?? $body['id'] ?? '' ) );
		$quantity   = min( 10, max( 1, absint( $body['quantity'] ?? $body['qty'] ?? 1 ) ) );
		if ( '' === $product_id || ! preg_match( '/^[A-Za-z0-9._:-]{1,100}$/', $product_id ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_product', __( 'Choose a valid Boutique item.', 'avenra-halo-v2' ), 422 );
		}

		$product = null;
		foreach ( $this->catalog_products() as $candidate ) {
			if ( (string) $candidate['id'] === $product_id ) {
				$product = $candidate;
				break;
			}
		}
		if ( ! $product || empty( $product['available'] ) ) {
			return Avenra_Halo_V2_Response::error( 'product_unavailable', __( 'That Boutique item is not currently available.', 'avenra-halo-v2' ), 409 );
		}

		$items   = $this->cart_state()['items'];
		$updated = false;
		foreach ( $items as &$item ) {
			if ( (string) $item['product_id'] === $product_id ) {
				$item['quantity']   = min( 10, (int) $item['quantity'] + $quantity );
				$item['line_total'] = round( (float) $item['price'] * (int) $item['quantity'], 2 );
				$updated = true;
				break;
			}
		}
		unset( $item );
		if ( ! $updated ) {
			if ( count( $items ) >= 20 ) {
				return Avenra_Halo_V2_Response::error( 'cart_limit_reached', __( 'Your basket already contains the maximum number of different items.', 'avenra-halo-v2' ), 409 );
			}
			$items[] = array(
				'line_id'    => 'line_' . substr( hash_hmac( 'sha256', $this->auth->customer_id() . '|' . $product_id, wp_salt( 'nonce' ) ), 0, 20 ),
				'product_id' => $product['id'],
				'name'       => $product['name'],
				'price'      => (float) $product['price'],
				'currency'   => $product['currency'],
				'image_url'  => $product['image_url'],
				'quantity'   => $quantity,
				'line_total' => round( (float) $product['price'] * $quantity, 2 ),
			);
		}

		return Avenra_Halo_V2_Response::success( array( 'cart' => $this->persist_cart( $items ) ), 201 );
	}

	public function remove_cart_item( WP_REST_Request $request ): WP_REST_Response {
		$line_id = sanitize_text_field( (string) $request['id'] );
		$items   = array_values(
			array_filter(
				$this->cart_state()['items'],
				static fn( array $item ): bool => ! hash_equals( (string) $item['line_id'], $line_id )
			)
		);
		return Avenra_Halo_V2_Response::success( array( 'cart' => $this->persist_cart( $items ) ) );
	}

	public function cart_checkout( WP_REST_Request $request ): WP_REST_Response {
		$cart = $this->cart_state();
		if ( empty( $cart['items'] ) ) {
			return Avenra_Halo_V2_Response::error( 'empty_cart', __( 'Your basket is empty.', 'avenra-halo-v2' ), 422 );
		}

		$items = array_map(
			static fn( array $item ): array => array( 'product_id' => $item['product_id'], 'quantity' => (int) $item['quantity'] ),
			$cart['items']
		);
		$handoff = apply_filters( 'avenra_halo_v2_shop_order_handoff', null, $items, $this->auth->customer_id(), $request );
		if ( is_array( $handoff ) ) {
			$response = $this->normalise_checkout_handoff( $handoff, $request );
			if ( null !== $response ) {
				return $response;
			}
		}

		if ( function_exists( 'wc_get_checkout_url' ) ) {
			$woocommerce_items = array_values(
				array_filter(
					array_map(
						static fn( array $item ): array => array( 'product_id' => absint( $item['product_id'] ), 'quantity' => (int) $item['quantity'] ),
						$items
					),
					static fn( array $item ): bool => $item['product_id'] > 0
				)
			);
			if ( $woocommerce_items ) {
				$token = Avenra_Halo_V2_Auth::random_token( 24 );
				set_transient( 'avh2_cart_' . hash( 'sha256', $token ), array( 'customer_id' => $this->auth->customer_id(), 'items' => $woocommerce_items ), 10 * MINUTE_IN_SECONDS );
				$url = add_query_arg( 'avenra_halo_handoff', rawurlencode( $token ), home_url( '/' ) );
				return Avenra_Halo_V2_Response::success( array( 'url' => $url, 'checkout_url' => $url, 'expires_in' => 600 ) );
			}
		}

		$legacy = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch( 'submit_boutique_order', array( 'cart' => wp_json_encode( $this->legacy_checkout_cart( $items ) ) ), $this->auth->customer_id() );
		if ( ! is_wp_error( $legacy ) ) {
			$response = $this->normalise_checkout_handoff( $legacy, $request );
			if ( null !== $response ) {
				return $response;
			}
		}

		return Avenra_Halo_V2_Response::error( 'checkout_unavailable', __( 'Secure checkout is temporarily unavailable. Your basket has been kept.', 'avenra-halo-v2' ), 503 );
	}

	public function manual( WP_REST_Request $request ): WP_REST_Response {
		return Avenra_Halo_V2_Response::success( $this->manual_payload() );
	}

	public function shop_order_handoff( WP_REST_Request $request ): WP_REST_Response {
		$body = $this->body( $request );
		$cart = $body['cart'] ?? $body['items'] ?? array();
		if ( is_string( $cart ) ) {
			$cart = json_decode( $cart, true );
		}
		if ( ! is_array( $cart ) || ! $cart || count( $cart ) > 20 ) {
			return Avenra_Halo_V2_Response::error( 'invalid_cart', __( 'Your basket was empty or invalid.', 'avenra-halo-v2' ), 422 );
		}

		$catalog = array();
		foreach ( $this->catalog_products() as $product ) {
			$catalog[ (string) $product['id'] ] = $product;
		}
		$items_by_id = array();
		$currency = null;
		foreach ( $cart as $item ) {
			if ( ! is_array( $item ) ) {
				return Avenra_Halo_V2_Response::error( 'invalid_cart', __( 'Your basket contained an invalid item.', 'avenra-halo-v2' ), 422 );
			}
			$product_id = sanitize_text_field( (string) ( $item['product_id'] ?? $item['id'] ?? '' ) );
			$quantity   = min( 10, max( 1, absint( $item['quantity'] ?? $item['qty'] ?? 1 ) ) );
			if ( ! preg_match( '/^[A-Za-z0-9._:-]{1,100}$/', $product_id ) || empty( $catalog[ $product_id ] ) || empty( $catalog[ $product_id ]['available'] ) ) {
				return Avenra_Halo_V2_Response::error( 'product_unavailable', __( 'A Boutique item in your basket is no longer available.', 'avenra-halo-v2' ), 409 );
			}
			$product = $catalog[ $product_id ];
			$product_currency = strtoupper( sanitize_text_field( (string) $product['currency'] ) );
			if ( null !== $currency && $currency !== $product_currency ) {
				return Avenra_Halo_V2_Response::error( 'mixed_cart_currency', __( 'Items using different currencies cannot be checked out together.', 'avenra-halo-v2' ), 422 );
			}
			$currency = $product_currency;
			if ( isset( $items_by_id[ $product_id ] ) ) {
				$items_by_id[ $product_id ]['quantity'] = min( 10, (int) $items_by_id[ $product_id ]['quantity'] + $quantity );
				$items_by_id[ $product_id ]['line_total'] = round( (float) $items_by_id[ $product_id ]['price'] * (int) $items_by_id[ $product_id ]['quantity'], 2 );
				continue;
			}
			$items_by_id[ $product_id ] = array(
				'product_id' => ctype_digit( $product_id ) ? (int) $product_id : $product_id,
				'quantity'   => $quantity,
				'name'       => sanitize_text_field( (string) $product['name'] ),
				'price'      => (float) $product['price'],
				'currency'   => $product_currency,
				'line_total' => round( (float) $product['price'] * $quantity, 2 ),
			);
		}
		$items = array_values( $items_by_id );
		if ( ! $items ) {
			return Avenra_Halo_V2_Response::error( 'invalid_cart', __( 'Your basket did not contain purchasable items.', 'avenra-halo-v2' ), 422 );
		}

		$handoff = apply_filters( 'avenra_halo_v2_shop_order_handoff', null, $items, $this->auth->customer_id(), $request );
		if ( is_array( $handoff ) ) {
			$response = $this->normalise_checkout_handoff( $handoff, $request );
			if ( null !== $response ) {
				return $response;
			}
		}

		if ( function_exists( 'wc_get_checkout_url' ) ) {
			$woocommerce_items = array_values( array_filter( array_map( static fn( array $item ): array => array( 'product_id' => absint( $item['product_id'] ), 'quantity' => (int) $item['quantity'] ), $items ), static fn( array $item ): bool => $item['product_id'] > 0 ) );
			if ( count( $woocommerce_items ) === count( $items ) ) {
				$token = Avenra_Halo_V2_Auth::random_token( 24 );
				set_transient( 'avh2_cart_' . hash( 'sha256', $token ), array( 'customer_id' => $this->auth->customer_id(), 'items' => $woocommerce_items ), 10 * MINUTE_IN_SECONDS );
				$url = add_query_arg( 'avenra_halo_handoff', rawurlencode( $token ), home_url( '/' ) );
				return Avenra_Halo_V2_Response::success( array( 'url' => $url, 'checkout_url' => $url, 'expires_in' => 600 ) );
			}
		}

		$legacy = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch( 'submit_boutique_order', array( 'cart' => wp_json_encode( $this->legacy_checkout_cart( $items ) ) ), $this->auth->customer_id() );
		if ( ! is_wp_error( $legacy ) ) {
			$response = $this->normalise_checkout_handoff( $legacy, $request );
			if ( null !== $response ) {
				return $response;
			}
		}

		return Avenra_Halo_V2_Response::error( 'checkout_unavailable', __( 'Secure checkout is temporarily unavailable.', 'avenra-halo-v2' ), 503 );
	}

	public function welcome_pack( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;

		$customer = $this->auth->customer();
		$vehicles = $this->vehicle_rows();
		$vehicle  = $vehicles ? $this->serialise_vehicle( $vehicles[0] ) : null;
		$document_count = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM `" . esc_sql( $this->db->table( 'documents' ) ) . "` WHERE customer_id = %d AND status = 'active'", $this->auth->customer_id() ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$data     = array(
			'title'      => __( 'Welcome to Avenrà', 'avenra-halo-v2' ),
			'first_name' => $this->auth->public_customer( $customer )['first_name'],
			'vehicle'    => $vehicle,
			'sections'   => array(
				array(
					'title'        => __( 'Before delivery', 'avenra-halo-v2' ),
					'content'      => __( 'Check your contact details, confirm your chosen ride-profile mappings and keep an eye on the build journey shown in Halo. Delivery timing is displayed only when it has been confirmed on your order.', 'avenra-halo-v2' ),
					'action_route' => 'vehicle',
					'action_label' => __( 'View your motorcycle', 'avenra-halo-v2' ),
				),
				array(
					'title'        => __( 'Your handover', 'avenra-halo-v2' ),
					'content'      => __( 'At handover, make sure you can identify the main controls, warning indications, charging equipment, VIN and isolation information for your exact motorcycle before riding away.', 'avenra-halo-v2' ),
					'action_route' => 'more/manual',
					'action_label' => __( 'Read the owner’s manual', 'avenra-halo-v2' ),
				),
				array(
					'title'        => __( 'Your first ride', 'avenra-halo-v2' ),
					'content'      => __( 'Start somewhere familiar, select a gentle ride mode and allow extra room while you learn the motorcycle’s immediate torque and regenerative deceleration.', 'avenra-halo-v2' ),
					'action_route' => 'ride',
					'action_label' => __( 'Open Ride mode', 'avenra-halo-v2' ),
				),
				array(
					'title'        => __( 'Documents and support', 'avenra-halo-v2' ),
					'content'      => __( 'Use Glovebox for your ownership, insurance, warranty and service documents. Halo keeps support details close at hand whenever you need help.', 'avenra-halo-v2' ),
					'action_route' => 'more/documents',
					'action_label' => __( 'Open Glovebox', 'avenra-halo-v2' ),
				),
			),
			'checklist'  => array(
				array( 'id' => 'profile', 'label' => __( 'Check your contact details', 'avenra-halo-v2' ), 'complete' => ! empty( $customer->email_address ) && ! empty( $customer->mobile_number ) ),
				array( 'id' => 'nok', 'label' => __( 'Add your next of kin', 'avenra-halo-v2' ), 'complete' => ! empty( $customer->nok_name ) && ! empty( $customer->nok_mobile ) ),
				array( 'id' => 'ride_profiles', 'label' => __( 'Choose your ride profiles', 'avenra-halo-v2' ), 'complete' => $vehicle && ! empty( $vehicle['configuration']['mode_1'] ) ),
				array( 'id' => 'documents', 'label' => __( 'Keep ownership documents in Glovebox', 'avenra-halo-v2' ), 'complete' => $document_count > 0 ),
			),
			'support' => array(
				'email' => (string) apply_filters( 'avenra_halo_v2_support_email', 'info@rideavenra.com' ),
				'phone' => (string) apply_filters( 'avenra_halo_v2_support_phone', '' ),
			),
		);
		return Avenra_Halo_V2_Response::success( (array) apply_filters( 'avenra_halo_v2_welcome_pack', $data, $customer, $vehicles ) );
	}

	public function route_plan( WP_REST_Request $request ): WP_REST_Response {
		$body        = $this->body( $request );
		$origin      = is_array( $body['origin'] ?? null ) ? $body['origin'] : array();
		$destination = is_array( $body['destination'] ?? null ) ? $body['destination'] : array();
		$preferences = is_array( $body['preferences'] ?? null ) ? $body['preferences'] : array();
		$origin_text = is_scalar( $body['origin'] ?? null ) ? (string) $body['origin'] : '';
		$destination_text = is_scalar( $body['destination'] ?? null ) ? (string) $body['destination'] : '';
		$start_query = $body['start_query'] ?? $origin['query'] ?? $origin['label'] ?? $origin['address'] ?? $origin_text;
		$end_query   = $body['end_query'] ?? $destination['query'] ?? $destination['label'] ?? $destination['address'] ?? $destination_text;
		$exclude     = $body['exclude'] ?? array();
		if ( is_string( $exclude ) ) {
			$exclude = preg_split( '/[\s,]+/', $exclude, -1, PREG_SPLIT_NO_EMPTY );
		}
		$exclude = is_array( $exclude ) ? $exclude : array();
		if ( $this->boolean( $preferences['avoid_motorways'] ?? $body['avoid_motorways'] ?? false ) ) {
			$exclude[] = 'motorway';
		}
		$payload = array(
			'start_query' => sanitize_text_field( is_scalar( $start_query ) ? (string) $start_query : '' ),
			'end_query'   => sanitize_text_field( is_scalar( $end_query ) ? (string) $end_query : '' ),
			'start_lat'   => $this->coordinate( $body['start_lat'] ?? $origin['lat'] ?? $origin['latitude'] ?? null, -90, 90 ),
			'start_lng'   => $this->coordinate( $body['start_lng'] ?? $origin['lng'] ?? $origin['longitude'] ?? null, -180, 180 ),
			'end_lat'     => $this->coordinate( $body['end_lat'] ?? $destination['lat'] ?? $destination['latitude'] ?? null, -90, 90 ),
			'end_lng'     => $this->coordinate( $body['end_lng'] ?? $destination['lng'] ?? $destination['longitude'] ?? null, -180, 180 ),
			'exclude'     => array_values( array_unique( array_intersect( array_map( 'sanitize_key', $exclude ), array( 'motorway', 'toll', 'ferry' ) ) ) ),
			'profile'     => sanitize_key( (string) ( $preferences['profile'] ?? $body['profile'] ?? 'balanced' ) ),
			'focus_zones' => $this->boolean( $preferences['focus_zones'] ?? $body['focus_zones'] ?? true ),
			'preferences' => $this->safe_json_value( $preferences, 10000 ),
		);
		if ( '' === $payload['end_query'] && ( null === $payload['end_lat'] || null === $payload['end_lng'] ) ) {
			return Avenra_Halo_V2_Response::error( 'destination_required', __( 'Choose a destination before finding routes.', 'avenra-halo-v2' ), 422 );
		}

		$plan = apply_filters( 'avenra_halo_v2_route_plan', null, $payload, $this->auth->customer_id(), $request );
		if ( is_array( $plan ) ) {
			return Avenra_Halo_V2_Response::success( $plan );
		}

		$legacy = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch( 'generate_safe_route_v22', $payload, $this->auth->customer_id() );
		if ( ! is_wp_error( $legacy ) ) {
			if ( ! empty( $legacy['success'] ) && is_array( $legacy['data'] ?? null ) ) {
				return Avenra_Halo_V2_Response::success( $legacy['data'] );
			}
			if ( isset( $legacy['routes'] ) ) {
				return Avenra_Halo_V2_Response::success( $legacy );
			}
		}

		$fallback = $this->directions_fallback_url( $payload );
		return Avenra_Halo_V2_Response::error( 'route_provider_unavailable', __( 'Halo route planning is temporarily unavailable. You can continue in your phone maps app.', 'avenra-halo-v2' ), 503, array( 'fallback_url' => $fallback ) );
	}

	public function normalise_response( $response, WP_REST_Server $server, WP_REST_Request $request ) {
		if ( ! str_starts_with( $request->get_route(), '/' . self::NS ) ) {
			return $response;
		}

		$response = rest_ensure_response( $response );
		$response->header( 'X-Halo-Request-ID', Avenra_Halo_V2_Response::request_id() );
		$response->header( 'Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'CDN-Cache-Control', 'no-store' );
		$response->header( 'Cloudflare-CDN-Cache-Control', 'no-store' );
		$response->header( 'Surrogate-Control', 'no-store' );
		$response->header( 'Pragma', 'no-cache' );
		$data = $response->get_data();

		if ( is_array( $data ) && isset( $data['_halo_private_file'] ) ) {
			return $response;
		}
		if ( is_array( $data ) && array_key_exists( 'ok', $data ) ) {
			return $response;
		}

		$status = $response->get_status();
		if ( $status >= 400 ) {
			$code    = is_array( $data ) && ! empty( $data['code'] ) ? sanitize_key( (string) $data['code'] ) : 'request_failed';
			$message = is_array( $data ) && ! empty( $data['message'] ) ? (string) $data['message'] : __( 'The request could not be completed.', 'avenra-halo-v2' );
			$details = is_array( $data ) && is_array( $data['data'] ?? null ) ? $data['data'] : array();
			unset( $details['status'] );
			$response->set_data(
				array(
					'ok'         => false,
					'error'      => array( 'code' => $code, 'message' => $message, 'details' => (object) $details ),
					'request_id' => Avenra_Halo_V2_Response::request_id(),
				)
			);
		} else {
			$response->set_data(
				array(
					'ok'         => true,
					'data'       => $data,
					'meta'       => (object) array(),
					'request_id' => Avenra_Halo_V2_Response::request_id(),
				)
			);
		}

		return $response;
	}

	public function serve_private_document( bool $served, WP_HTTP_Response $result, WP_REST_Request $request, WP_REST_Server $server ): bool {
		if ( $served || ! str_starts_with( $request->get_route(), '/' . self::NS . '/' ) ) {
			return $served;
		}

		$data = $result->get_data();
		if ( ! is_array( $data ) || empty( $data['_halo_private_file'] ) || ! is_file( $data['_halo_private_file'] ) ) {
			return false;
		}

		$filename = sanitize_file_name( (string) ( $data['filename'] ?? basename( $data['_halo_private_file'] ) ) );
		$mime     = sanitize_mime_type( (string) ( $data['mime_type'] ?? 'application/octet-stream' ) );
		$disposition = 'inline' === ( $data['disposition'] ?? '' ) ? 'inline' : 'attachment';
		nocache_headers();
		header( 'Content-Type: ' . ( $mime ?: 'application/octet-stream' ) );
		header( 'Content-Length: ' . (string) filesize( $data['_halo_private_file'] ) );
		header( 'Content-Disposition: ' . $disposition . '; filename="' . str_replace( '"', '', $filename ) . '"' );
		header( 'X-Content-Type-Options: nosniff' );
		readfile( $data['_halo_private_file'] ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile
		return true;
	}

	/** @return array<int,array<string,mixed>> */
	private function catalog_products(): array {
		$products = array();
		if ( function_exists( 'wc_get_products' ) ) {
			foreach ( wc_get_products( array( 'status' => 'publish', 'limit' => 50, 'orderby' => 'menu_order', 'order' => 'ASC' ) ) as $product ) {
				$image_id = (int) $product->get_image_id();
				$products[] = array(
					'id'          => (int) $product->get_id(),
					'sku'         => sanitize_text_field( (string) $product->get_sku() ),
					'name'        => wp_strip_all_tags( $product->get_name() ),
					'description' => wp_strip_all_tags( $product->get_short_description() ),
					'price'       => (float) $product->get_price(),
					'currency'    => get_woocommerce_currency(),
					'image_url'   => $image_id ? wp_get_attachment_image_url( $image_id, 'medium' ) : null,
					'available'   => $product->is_purchasable() && $product->is_in_stock(),
					'product_url' => get_permalink( $product->get_id() ),
				);
			}
		}
		if ( ! $products ) {
			// Preserve the six-item Boutique shipped in Halo V1 when WooCommerce
			// (or another server-owned catalog provider) is not installed.
			$products = array(
				array( 'id' => 'app_helmet', 'name' => 'Carbon Fibre Helmet', 'description' => 'Ultra lightweight protection.', 'price' => 149, 'currency' => 'GBP', 'image_url' => 'https://cdn.jsac.media/media/76293/01JV7QJQKSP7DJWJ7PV39G91EW.JPG?width=500', 'available' => true ),
				array( 'id' => 'app_trousers', 'name' => 'RST Ride Trousers', 'description' => 'Standard or Black Jean.', 'price' => 199, 'currency' => 'GBP', 'image_url' => 'https://cdn.jsac.media/media/1542/rst-pro-series-raid-textile-jeans-black-size-mens-uk-xl-117118-01.jpg?width=500', 'available' => true ),
				array( 'id' => 'app_bobbins', 'name' => 'Crash Protection Pack', 'description' => 'Paddock stand bobbins.', 'price' => 139, 'currency' => 'GBP', 'image_url' => 'https://cdn.jsac.media/media/2639/bike-it-paddock-stand-bobbins-8mm-red-red-120040-01.jpg?width=500', 'available' => true ),
				array( 'id' => 'app_guards', 'name' => 'Lever Guards', 'description' => 'Racing LH & RH protection.', 'price' => 149, 'currency' => 'GBP', 'image_url' => 'https://cdn.jsac.media/media/4914/oxford-products-lever-guard-racing-lh-lever-guard-racing-lh-130434-01.jpg?width=500', 'available' => true ),
				array( 'id' => 'app_cover', 'name' => 'Ampera Bike Cover', 'description' => 'Weather resistant polyester.', 'price' => 199, 'currency' => 'GBP', 'image_url' => 'https://cdn.jsac.media/media/78681/01K09MN8X925D7CX1GYQQYDS5E.jpg?width=500', 'available' => true ),
				array( 'id' => 'app_gloves', 'name' => 'Black Ampera Gloves', 'description' => 'Dynamic II riding gloves.', 'price' => 79, 'currency' => 'GBP', 'image_url' => 'https://cdn.jsac.media/media/31288/frank-thomas-dynamic-ii-gloves-black-mens-m-dynamic-2-01.jpg?width=500', 'available' => true ),
			);
		}

		$source = (array) apply_filters( 'avenra_halo_v2_shop_catalog', $products, $this->auth->customer_id() );
		$clean  = array();
		foreach ( array_slice( $source, 0, 100 ) as $product ) {
			if ( ! is_array( $product ) ) {
				continue;
			}
			$id = sanitize_text_field( (string) ( $product['id'] ?? $product['product_id'] ?? $product['sku'] ?? '' ) );
			if ( '' === $id || ! preg_match( '/^[A-Za-z0-9._:-]{1,100}$/', $id ) ) {
				continue;
			}
			$currency = strtoupper( sanitize_text_field( (string) ( $product['currency'] ?? 'GBP' ) ) );
			if ( ! preg_match( '/^[A-Z]{3}$/', $currency ) ) {
				$currency = 'GBP';
			}
			$clean[] = array(
				'id'          => ctype_digit( $id ) ? (int) $id : $id,
				'sku'         => sanitize_text_field( (string) ( $product['sku'] ?? '' ) ),
				'name'        => $this->text_substr( sanitize_text_field( (string) ( $product['name'] ?? __( 'Avenrà item', 'avenra-halo-v2' ) ) ), 0, 160 ),
				'description' => $this->text_substr( sanitize_textarea_field( (string) ( $product['description'] ?? '' ) ), 0, 1000 ),
				'price'       => $this->number( $product['price'] ?? 0, 0, 1000000, 0 ),
				'currency'    => $currency,
				'image_url'   => ! empty( $product['image_url'] ?? $product['image'] ?? '' ) ? esc_url_raw( (string) ( $product['image_url'] ?? $product['image'] ) ) : null,
				'available'   => ! array_key_exists( 'available', $product ) || $this->boolean( $product['available'] ),
				'product_url' => ! empty( $product['product_url'] ?? $product['url'] ?? '' ) ? esc_url_raw( (string) ( $product['product_url'] ?? $product['url'] ) ) : null,
			);
		}
		return $clean;
	}

	/**
	 * Normalise checkout integrations to one of the two contracts understood by
	 * the V2 client: a same/provider-supplied URL or a Stripe Checkout session.
	 *
	 * @param array<string,mixed> $handoff
	 */
	private function normalise_checkout_handoff( array $handoff, WP_REST_Request $request ): ?WP_REST_Response {
		$raw_url = (string) ( $handoff['checkout_url'] ?? $handoff['stripe_session_url'] ?? $handoff['url'] ?? '' );
		if ( '' !== $raw_url ) {
			$url = esc_url_raw( $raw_url, array( 'http', 'https' ) );
			if ( '' === $url ) {
				return Avenra_Halo_V2_Response::error( 'invalid_checkout_url', __( 'The checkout service returned an invalid address. Your basket has been kept.', 'avenra-halo-v2' ), 502 );
			}
			return Avenra_Halo_V2_Response::success( array_merge( $handoff, array( 'url' => $url, 'checkout_url' => $url ) ) );
		}

		$session_id = sanitize_text_field( (string) ( $handoff['stripe_session_id'] ?? '' ) );
		if ( '' === $session_id ) {
			return null;
		}
		if ( ! preg_match( '/^cs_[A-Za-z0-9_]{8,255}$/', $session_id ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_checkout_session', __( 'The checkout service returned an invalid session. Your basket has been kept.', 'avenra-halo-v2' ), 502 );
		}

		$url = $this->stripe_checkout_session_url( $session_id, $handoff, $request );
		if ( '' === $url ) {
			return Avenra_Halo_V2_Response::error( 'checkout_session_url_missing', __( 'Secure checkout could not resolve its hosted payment page. Your basket has been kept.', 'avenra-halo-v2' ), 503 );
		}

		return Avenra_Halo_V2_Response::success(
			array(
				'checkout_provider' => 'stripe',
				'url'               => $url,
				'checkout_url'      => $url,
			)
		);
	}

	/**
	 * Resolve a legacy Stripe Checkout Session to its hosted URL. The secret is
	 * server-only and is never returned to the Halo client.
	 *
	 * @param array<string,mixed> $handoff
	 */
	private function stripe_checkout_session_url( string $session_id, array $handoff, WP_REST_Request $request ): string {
		$resolved = apply_filters( 'avenra_halo_v2_stripe_checkout_session_url', null, $session_id, $handoff, $this->auth->customer_id(), $request );
		if ( is_array( $resolved ) ) {
			$resolved = $resolved['checkout_url'] ?? $resolved['url'] ?? '';
		}
		$url = esc_url_raw( is_string( $resolved ) ? $resolved : '', array( 'https' ) );
		if ( '' !== $url ) {
			return $url;
		}

		$secret = defined( 'AVENRA_HALO_STRIPE_SECRET_KEY' ) ? (string) constant( 'AVENRA_HALO_STRIPE_SECRET_KEY' ) : '';
		$secret = trim( (string) apply_filters( 'avenra_halo_v2_stripe_secret_key', $secret, $session_id, $this->auth->customer_id(), $request ) );
		if ( ! preg_match( '/^(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]{8,255}$/', $secret ) ) {
			return '';
		}

		$args = array(
			'timeout'             => 15,
			'redirection'         => 0,
			'limit_response_size' => 1024 * 1024,
			'headers'             => array(
				'Accept'        => 'application/json',
				'Authorization' => 'Bearer ' . $secret,
			),
		);
		$args = (array) apply_filters( 'avenra_halo_v2_stripe_session_request_args', $args, $session_id, $this->auth->customer_id() );
		$response = wp_safe_remote_get( 'https://api.stripe.com/v1/checkout/sessions/' . rawurlencode( $session_id ), $args );
		if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
			do_action( 'avenra_halo_v2_checkout_resolution_error', $session_id, is_wp_error( $response ) ? $response->get_error_code() : wp_remote_retrieve_response_code( $response ), Avenra_Halo_V2_Response::request_id() );
			return '';
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		return esc_url_raw( is_array( $body ) ? (string) ( $body['url'] ?? '' ) : '', array( 'https' ) );
	}

	/**
	 * Adapt the validated V2 basket to the row-per-unit shape used by V1.
	 * Names, prices and images always come from the server catalog.
	 *
	 * @param array<int,array<string,mixed>> $items
	 * @return array<int,array<string,mixed>>
	 */
	private function legacy_checkout_cart( array $items ): array {
		$catalog = array();
		foreach ( $this->catalog_products() as $product ) {
			$catalog[ (string) $product['id'] ] = $product;
		}

		$legacy = array();
		$serial = 0;
		$stamp  = (int) floor( microtime( true ) * 1000 );
		foreach ( array_slice( $items, 0, 20 ) as $item ) {
			$product_id = sanitize_text_field( (string) ( $item['product_id'] ?? $item['id'] ?? '' ) );
			if ( '' === $product_id || empty( $catalog[ $product_id ] ) || empty( $catalog[ $product_id ]['available'] ) ) {
				continue;
			}
			$product  = $catalog[ $product_id ];
			$quantity = min( 10, max( 1, absint( $item['quantity'] ?? $item['qty'] ?? 1 ) ) );
			for ( $unit = 0; $unit < $quantity; $unit++ ) {
				$serial++;
				$legacy[] = array(
					'id'         => $product['id'],
					'product_id' => $product['id'],
					'price'      => (float) $product['price'],
					'name'       => sanitize_text_field( (string) $product['name'] ),
					'img'        => ! empty( $product['image_url'] ) ? esc_url_raw( (string) $product['image_url'] ) : '',
					'cartItemId' => $stamp + $serial,
					'quantity'   => 1,
					'currency'   => sanitize_text_field( (string) $product['currency'] ),
				);
			}
		}

		$adapted = apply_filters( 'avenra_halo_v2_legacy_checkout_cart', $legacy, $items, $this->auth->customer_id() );
		return is_array( $adapted ) ? array_values( $adapted ) : $legacy;
	}

	private function cart_key(): string {
		return 'avh2_cart_state_' . $this->auth->customer_id();
	}

	/** @return array{items:array<int,array<string,mixed>>,count:int,total:float,currency:string} */
	private function cart_state(): array {
		$stored = get_transient( $this->cart_key() );
		$source = is_array( $stored ) ? ( $stored['items'] ?? $stored ) : array();
		$items  = array();
		foreach ( array_slice( is_array( $source ) ? $source : array(), 0, 20 ) as $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			$product_id = sanitize_text_field( (string) ( $item['product_id'] ?? '' ) );
			$line_id    = sanitize_text_field( (string) ( $item['line_id'] ?? $item['id'] ?? '' ) );
			if ( '' === $product_id || ! preg_match( '/^[A-Za-z0-9_-]{8,80}$/', $line_id ) ) {
				continue;
			}
			$quantity = min( 10, max( 1, absint( $item['quantity'] ?? 1 ) ) );
			$price    = $this->number( $item['price'] ?? 0, 0, 1000000, 0 );
			$currency = strtoupper( sanitize_text_field( (string) ( $item['currency'] ?? 'GBP' ) ) );
			$currency = preg_match( '/^[A-Z]{3}$/', $currency ) ? $currency : 'GBP';
			$items[]  = array(
				'line_id'    => $line_id,
				'id'         => $line_id,
				'product_id' => ctype_digit( $product_id ) ? (int) $product_id : $product_id,
				'name'       => $this->text_substr( sanitize_text_field( (string) ( $item['name'] ?? __( 'Avenrà item', 'avenra-halo-v2' ) ) ), 0, 160 ),
				'price'      => $price,
				'currency'   => $currency,
				'image_url'  => ! empty( $item['image_url'] ) ? esc_url_raw( (string) $item['image_url'] ) : null,
				'quantity'   => $quantity,
				'line_total' => round( $price * $quantity, 2 ),
			);
		}

		$count    = array_sum( array_map( static fn( array $item ): int => (int) $item['quantity'], $items ) );
		$total    = array_sum( array_map( static fn( array $item ): float => (float) $item['line_total'], $items ) );
		$currency = $items ? (string) $items[0]['currency'] : 'GBP';
		return array( 'items' => $items, 'count' => $count, 'total' => round( $total, 2 ), 'currency' => $currency );
	}

	/** @param array<int,array<string,mixed>> $items */
	private function persist_cart( array $items ): array {
		if ( $items ) {
			set_transient( $this->cart_key(), array( 'items' => array_values( $items ) ), 7 * DAY_IN_SECONDS );
		} else {
			delete_transient( $this->cart_key() );
		}
		return $this->cart_state();
	}

	/** @return array<string,mixed> */
	private function manual_payload(): array {
		$sections = array(
			array(
				'id'         => 'support',
				'title'      => __( 'Introduction, VIN and support', 'avenra-halo-v2' ),
				'summary'    => __( 'Identify your motorcycle and know how to ask for help.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'Your 17-character VIN is the legal identifier used for registration, insurance and warranty support. Check it against the manufacturer plate and the vehicle record shown in Halo.', 'avenra-halo-v2' ),
					__( 'Report faults and arrange service through the support route shown in Halo. For an immediate danger, move to a safe place and contact the emergency services before technical support.', 'avenra-halo-v2' ),
				),
			),
			array(
				'id'         => 'high-voltage-safety',
				'title'      => __( 'High-voltage and emergency safety', 'avenra-halo-v2' ),
				'summary'    => __( 'Essential precautions for the battery and high-voltage system.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'Never touch, cut, modify or probe orange cabling, and never open the traction battery, inverter, charger or motor enclosures. High-voltage work must be carried out by appropriately trained Avenrà personnel.', 'avenra-halo-v2' ),
					__( 'After a collision, flooding, smoke, unusual heat or smell, or an HV isolation warning: stop as soon as it is safe, switch the motorcycle off, do not charge it, keep people clear and seek emergency or Avenrà assistance.', 'avenra-halo-v2' ),
					__( 'The throttle should remain inhibited while the side stand is down or charging equipment is connected. Never rely on an interlock as a substitute for switching the motorcycle off before inspection.', 'avenra-halo-v2' ),
				),
			),
			array(
				'id'         => 'controls',
				'title'      => __( 'Controls', 'avenra-halo-v2' ),
				'summary'    => __( 'Throttle, braking, lighting and handlebar controls.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'The right-hand controls provide the throttle and ride-mode selection; equipment-dependent functions can include reverse and cruise control. Confirm the switches fitted to your motorcycle at handover before using them.', 'avenra-halo-v2' ),
					__( 'The left-hand controls operate lighting, indicators, the horn, hazard warning and Park/standby where fitted. Learn every control while stationary and with the motorcycle made safe.', 'avenra-halo-v2' ),
					__( 'Electric drive can deliver torque immediately and quietly. Keep both brakes covered while manoeuvring and confirm the ready/drive indication before turning the throttle.', 'avenra-halo-v2' ),
				),
			),
			array(
				'id'         => 'displays-alerts',
				'title'      => __( 'Displays and alerts', 'avenra-halo-v2' ),
				'summary'    => __( 'Understand telemetry, low-energy indications and critical warnings.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'The cockpit can show state of charge, estimated range, speed, trip distance and live power information. Range is an estimate and changes with speed, temperature, terrain, payload and riding style.', 'avenra-halo-v2' ),
					__( 'A low-energy or turtle indication means performance may be limited. Reduce demand and arrange charging. If a red high-voltage or isolation warning appears, stop safely, switch off and contact Avenrà support.', 'avenra-halo-v2' ),
					__( 'Phone projection and connected features vary by motorcycle specification. Set up devices while parked and never operate a handheld phone while riding.', 'avenra-halo-v2' ),
				),
			),
			array(
				'id'         => 'ride-modes',
				'title'      => __( 'Ride modes and regeneration', 'avenra-halo-v2' ),
				'summary'    => __( 'Three handlebar mappings with adjustable regenerative deceleration.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'Halo lets you map three handlebar positions to available profiles. Eco/Rain favours a softer response, City/Road balances response and efficiency, and Sport uses the most immediate response available to the motorcycle.', 'avenra-halo-v2' ),
					__( 'Regeneration slows the motorcycle when the throttle is released and can recover energy. Higher regeneration can feel like strong engine braking; learn each setting on a familiar, dry road before using it in reduced grip.', 'avenra-halo-v2' ),
					__( 'Track-related functions, traction control and ABS availability depend on the exact model and options. Public-road laws and the motorcycle’s own safety indications always take priority over an app preference.', 'avenra-halo-v2' ),
				),
			),
			array(
				'id'         => 'charging',
				'title'      => __( 'Charging and range', 'avenra-halo-v2' ),
				'summary'    => __( 'Connect safely and protect battery performance.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'Park securely, switch the motorcycle off and inspect the inlet and cable before every charge. Do not connect wet, contaminated, damaged or unusually hot equipment, and use only compatible approved charging equipment.', 'avenra-halo-v2' ),
					__( 'Confirm the charging indication before leaving the motorcycle. If charging stops repeatedly, a connector becomes hot, or a fault is shown, disconnect only when safe and contact Avenrà support.', 'avenra-halo-v2' ),
					__( 'Moderate speed, correct tyre pressure, smooth acceleration and appropriate regeneration can extend range. Never plan to consume the final displayed mile of range; retain a practical reserve.', 'avenra-halo-v2' ),
				),
			),
			array(
				'id'         => 'care-maintenance',
				'title'      => __( 'Care and maintenance', 'avenra-halo-v2' ),
				'summary'    => __( 'Routine checks, cleaning, storage and transport.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'Before riding, check tyres, brakes, steering, suspension, lights, mirrors, fasteners and for leaks or visible damage. Use the pressures and wear limits specified on the motorcycle and by Avenrà.', 'avenra-halo-v2' ),
					__( 'Clean with a soft sponge and low-pressure water. Do not direct a pressure washer at bearings, seals, electrical connectors, the charging inlet or high-voltage components, and allow the motorcycle to dry before charging.', 'avenra-halo-v2' ),
					__( 'For transport, use suitable soft ties at approved structural points. Never pass straps across the battery enclosure or orange cabling. High-voltage and drive-system servicing is not owner maintenance.', 'avenra-halo-v2' ),
				),
			),
			array(
				'id'         => 'one-evo-specifications',
				'title'      => __( 'ONE and EVO specifications', 'avenra-halo-v2' ),
				'summary'    => __( 'Reference performance and charging figures from the Halo owner manual.', 'avenra-halo-v2' ),
				'paragraphs' => array(
					__( 'Avenrà ONE: L3e-A1 / CBT category; 11 kW peak power; 120 Nm; 62 mph reference top speed; 99-mile EEC reference range; 72 V 80 Ah lithium battery; approximately one hour at 3.4 kW; 110 kg excluding battery.', 'avenra-halo-v2' ),
					__( 'Avenrà EVO: L3e-A1 high-performance / CBT category; 37 kW peak power; 160 Nm; 109 mph reference top speed; approximately 3.9 seconds 0–60 mph; 89-mile EEC reference range; 11.5 kWh battery; approximately 2 hours 40 minutes at 3.4 kW; 170 kg.', 'avenra-halo-v2' ),
					__( 'Specifications, homologation, fitted equipment, charging time and usable range can vary by market, software, options and production revision. Your order, compliance plate and current Avenrà technical information take priority.', 'avenra-halo-v2' ),
				),
			),
		);

		return (array) apply_filters(
			'avenra_halo_v2_manual',
			array(
				'title'    => __( 'Digital Owner’s Manual', 'avenra-halo-v2' ),
				'models'   => array( 'Avenrà ONE', 'Avenrà EVO' ),
				'version'  => AVENRA_HALO_V2_VERSION,
				'sections' => $sections,
			),
			$this->auth->customer_id()
		);
	}

	/** @return array<string,bool> */
	private function features(): array {
		return (array) apply_filters(
			'avenra_halo_v2_features',
			array(
				'multi_vehicle' => true,
				'rides'         => true,
				'hazards'       => true,
					'emergency_assist' => true,
					'live_tracking' => true,
					'guardian_recovery' => true,
				'documents'     => true,
				'community'     => true,
				'shop'          => true,
				'route_planning'=> has_action( 'wp_ajax_generate_safe_route_v22' ) || has_filter( 'avenra_halo_v2_route_plan' ),
				'used_claims'   => true,
			)
		);
	}

	/** @return array<string,mixed> */
	private function safety_data( object $customer ): array {
		$assist = Avenra_Halo_V2_Emergency::instance()->get_assist_settings( (int) ( $customer->id ?? 0 ) );
		$camera = class_exists( 'Avenra_Halo_V2_Incident_Media' )
			? Avenra_Halo_V2_Incident_Media::instance()->get_camera_settings( (int) ( $customer->id ?? 0 ) )
			: array( 'enabled' => false, 'dual_enabled' => false, 'consent_current' => false, 'required_consent_version' => '1' );
		$flat = array(
			'mobile'            => sanitize_text_field( (string) ( $customer->mobile_number ?? $customer->mobile ?? '' ) ),
			'nok_name'          => sanitize_text_field( (string) ( $customer->nok_name ?? '' ) ),
			'nok_mobile'        => sanitize_text_field( (string) ( $customer->nok_mobile ?? '' ) ),
			'nok_relation'      => sanitize_text_field( (string) ( $customer->nok_relation ?? '' ) ),
			'date_of_birth'     => $this->valid_date( (string) ( $customer->date_of_birth ?? '' ) ),
			'blood_type'        => sanitize_text_field( (string) ( $customer->blood_type ?? '' ) ),
			'weight_kg'         => is_numeric( $customer->weight_kg ?? null ) ? (float) $customer->weight_kg : null,
			'medical_notes'     => sanitize_textarea_field( (string) ( $customer->medical_notes ?? '' ) ),
			'halo_proxy'        => ! empty( $assist['proxy_authority_enabled'] ),
			// A legacy raw flag is not sufficient evidence for V2 health-data
			// disclosure; only the current versioned plugin-owned choice is used.
			'halo_emergency'    => ! empty( $assist['medical_consent_current'] ),
			'halo_nok_consent'  => ! empty( $assist['nok_alerts_enabled'] ),
			'halo_law'          => ! empty( $assist['law_release_enabled'] ),
			'halo_ai'           => ! empty( $assist['research_enabled'] ),
			'emergency_assist_enabled' => ! empty( $assist['consent_current'] ),
			'test_ride_monitoring_armed' => ! empty( $assist['test_ride_monitoring_armed'] ),
			'test_ride_monitoring_arm_id' => sanitize_text_field( (string) ( $assist['test_ride_monitoring_arm_id'] ?? '' ) ),
			'incident_camera_enabled' => ! empty( $camera['consent_current'] ),
			'incident_camera_dual_enabled' => ! empty( $camera['dual_enabled'] ),
		);
		$flat['halo_emergency_assist'] = $flat['emergency_assist_enabled'];
		$flat['emergency_assist'] = array(
			'enabled'         => $flat['emergency_assist_enabled'],
			'stored_enabled'  => ! empty( $assist['assist_enabled'] ),
			'consent_current' => ! empty( $assist['consent_current'] ),
			'renewal_required'=> ! empty( $assist['assist_enabled'] ) && empty( $assist['consent_current'] ),
			'consent_version' => sanitize_text_field( (string) ( $assist['consent_version'] ?? '' ) ),
			'required_consent_version' => sanitize_text_field( (string) ( $assist['required_consent_version'] ?? '' ) ),
			'consented_at'    => $assist['consented_at'] ?? null,
			'revoked_at'      => $assist['revoked_at'] ?? null,
			'provider_ready'  => Avenra_Halo_V2_Emergency::instance()->provider_ready(),
			'medical_sharing_enabled' => ! empty( $assist['medical_consent_current'] ),
			'medical_stored_enabled'  => ! empty( $assist['medical_sharing_enabled'] ),
			'medical_renewal_required'=> ! empty( $assist['medical_sharing_enabled'] ) && empty( $assist['medical_consent_current'] ),
			'medical_consent_version' => sanitize_text_field( (string) ( $assist['medical_consent_version'] ?? '' ) ),
			'required_medical_consent_version' => sanitize_text_field( (string) ( $assist['required_medical_consent_version'] ?? '' ) ),
			'medical_consented_at' => $assist['medical_consented_at'] ?? null,
			'medical_revoked_at'   => $assist['medical_revoked_at'] ?? null,
		);
		$flat['test_ride_monitoring'] = array(
			'armed'                    => $flat['test_ride_monitoring_armed'],
			'arm_id'                   => $flat['test_ride_monitoring_arm_id'],
			'active'                   => ! empty( $assist['test_ride_monitoring_active'] ),
			'stored_armed'             => ! empty( $assist['test_ride_monitoring_stored_armed'] ),
			'consent_current'          => ! empty( $assist['test_ride_monitoring_consent_current'] ),
			'consent_version'          => sanitize_text_field( (string) ( $assist['test_ride_monitoring_consent_version'] ?? '' ) ),
			'required_consent_version' => sanitize_text_field( (string) ( $assist['required_test_ride_monitoring_consent_version'] ?? '1' ) ),
			'consented_at'             => $assist['test_ride_monitoring_consented_at'] ?? null,
			'revoked_at'               => $assist['test_ride_monitoring_revoked_at'] ?? null,
			'armed_until'              => $assist['test_ride_monitoring_armed_until'] ?? null,
		);
		$flat['incident_camera'] = $camera;
		$flat['nok'] = array(
			'name'         => $flat['nok_name'],
			'mobile'       => $flat['nok_mobile'],
			'phone'        => $flat['nok_mobile'],
			'relationship' => $flat['nok_relation'],
		);
		$flat['emergency_contact'] = $flat['nok'];
		$flat['medical'] = array(
			'date_of_birth' => $flat['date_of_birth'],
			'blood_group'   => $flat['blood_type'],
			'blood_type'    => $flat['blood_type'],
			'weight_kg'     => $flat['weight_kg'],
			'notes'         => $flat['medical_notes'],
		);
		$flat['consents'] = array(
			'nok_alerts'      => $flat['halo_nok_consent'],
			'medical_sharing' => $flat['halo_emergency'],
			'emergency_assist_enabled' => $flat['emergency_assist_enabled'],
			'test_ride_monitoring' => $flat['test_ride_monitoring'],
			'incident_camera' => $flat['incident_camera_enabled'],
			'proxy'            => $flat['halo_proxy'],
			'law_enforcement' => $flat['halo_law'],
			'ai_processing'   => $flat['halo_ai'],
		);
		return $flat;
	}

	private function vehicle_lifecycle( ?array $vehicle ): string {
		if ( ! $vehicle ) {
			return 'prospect';
		}
		if ( ! empty( $vehicle['is_owned'] ) || ! empty( $vehicle['delivered_at'] ) ) {
			return 'owner';
		}
		return 'pre-delivery';
	}

	private function mask_vin( string $vin ): string {
		$vin = strtoupper( preg_replace( '/[^A-HJ-NPR-Z0-9]/', '', $vin ) );
		if ( strlen( $vin ) <= 7 ) {
			return $vin;
		}
		return substr( $vin, 0, 3 ) . str_repeat( '•', max( 3, strlen( $vin ) - 7 ) ) . substr( $vin, -4 );
	}

	/** @return array<string,array<string,mixed>> */
	private function vehicle_colour_catalog( object $row ): array {
		$catalog = array(
			'silverstone-black' => array(
				'key' => 'silverstone-black', 'label' => 'Silverstone Gloss Metallic Black', 'aliases' => array( 'Silverstone Black', 'Silverstone Metallic Black', 'Silverstone Gloss Black' ), 'option_ids' => array(), 'swatch' => '#000000',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/03/file_00000000e00071fdb0583761e854a132.png',
			),
			'brands-hatch-blue' => array(
				'key' => 'brands-hatch-blue', 'label' => 'Brands Hatch Blue', 'aliases' => array(), 'option_ids' => array(), 'swatch' => '#1e3a8a',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/03/file_0000000085ec71fd8947474f9ba94f70.png',
			),
			'thruxton-red' => array(
				'key' => 'thruxton-red', 'label' => 'Thruxton Racing Red', 'aliases' => array( 'Thruxton Red' ), 'option_ids' => array(), 'swatch' => '#dc2626',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/03/file_00000000e21071f8aef265099c5930a1.png',
			),
			'snetterton-white' => array(
				'key' => 'snetterton-white', 'label' => 'Snetterton Gloss White', 'aliases' => array( 'Snetterton White' ), 'option_ids' => array(), 'swatch' => '#f3f4f6',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/03/file_00000000485071f886014118f867d54f.png',
			),
			'oulton-black' => array(
				'key' => 'oulton-black', 'label' => 'Oulton Black', 'aliases' => array(), 'option_ids' => array( 'opt_paint_oulton' ), 'swatch' => '#1a1a1a',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/03/file_00000000357871fdb40b486e38fe15cd.png',
			),
			'knockhill-blue' => array(
				'key' => 'knockhill-blue', 'label' => 'Knockhill Blue', 'aliases' => array(), 'option_ids' => array( 'opt_paint_knockhill' ), 'swatch' => '#172554',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/05/1778262843390.png',
			),
			'donnington-grey' => array(
				'key' => 'donnington-grey', 'label' => 'Donnington Grey', 'aliases' => array( 'Donington Grey', 'Donnington Gray', 'Donington Gray' ), 'option_ids' => array( 'opt_paint_donnington' ), 'swatch' => '#4b5563',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/05/1778262790750.png',
			),
			'cadwell-green' => array(
				'key' => 'cadwell-green', 'label' => 'Cadwell Green', 'aliases' => array(), 'option_ids' => array( 'opt_paint_cadwell' ), 'swatch' => '#064e3b',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/05/1778263113881.png',
			),
			'personality-colour' => array(
				'key' => 'personality-colour', 'label' => 'Personality Colour', 'aliases' => array( 'Personality Color', 'Custom Colour', 'Custom Color', 'Bespoke Colour', 'Bespoke Color' ), 'option_ids' => array( 'opt_paint_custom' ),
				'swatch' => 'conic-gradient(from 180deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
				'image_url' => 'https://rideavenra.com/wp-content/uploads/2026/03/file_00000000357871fdb40b486e38fe15cd.png',
			),
		);

		$catalog = (array) apply_filters( 'avenra_halo_v2_vehicle_colour_catalog', $catalog, $row );
		$clean   = array();
		foreach ( $catalog as $key => $definition ) {
			if ( ! is_array( $definition ) ) {
				continue;
			}
			$catalog_key = sanitize_key( (string) ( $definition['key'] ?? $key ) );
			$label       = sanitize_text_field( (string) ( $definition['label'] ?? '' ) );
			$image       = esc_url_raw( (string) ( $definition['image_url'] ?? '' ) );
			$swatch      = trim( (string) ( $definition['swatch'] ?? '' ) );
			if ( '' === $catalog_key || '' === $label ) {
				continue;
			}
			if ( ! preg_match( '/^#[0-9a-f]{6}$/i', $swatch ) && ! preg_match( '/^conic-gradient\(from 180deg(?:,\s*#[0-9a-f]{6}){2,12}\)$/i', $swatch ) ) {
				$swatch = '#5f656b';
			}
			$clean[ $catalog_key ] = array(
				'key'        => $catalog_key,
				'label'      => $label,
				'aliases'    => array_values( array_filter( array_map( 'sanitize_text_field', (array) ( $definition['aliases'] ?? array() ) ) ) ),
				'option_ids' => array_values( array_filter( array_map( 'sanitize_key', (array) ( $definition['option_ids'] ?? array() ) ) ) ),
				'swatch'     => $swatch,
				'image_url'  => $image,
			);
		}

		// Keep the original flat image hook working for existing installations.
		$legacy_images = array();
		foreach ( $clean as $definition ) {
			$legacy_images[ $definition['label'] ] = $definition['image_url'];
		}
		$legacy_images = (array) apply_filters( 'avenra_halo_v2_vehicle_colour_images', $legacy_images, $row );
		foreach ( $clean as &$definition ) {
			$definition['image_url'] = '';
		}
		unset( $definition );
		foreach ( $legacy_images as $legacy_label => $legacy_url ) {
			$label = sanitize_text_field( (string) $legacy_label );
			$image = esc_url_raw( (string) $legacy_url );
			if ( '' === $label || '' === $image ) {
				continue;
			}
			$matched = false;
			foreach ( $clean as &$definition ) {
				$known_labels = array_merge( array( $definition['label'] ), (array) $definition['aliases'] );
				$known_labels = array_map( array( $this, 'normalise_vehicle_colour_label' ), $known_labels );
				if ( in_array( $this->normalise_vehicle_colour_label( $label ), $known_labels, true ) ) {
					$definition['image_url'] = $image;
					$matched = true;
					break;
				}
			}
			unset( $definition );
			if ( ! $matched ) {
				$key = 'legacy-' . sanitize_title( $label );
				if ( isset( $clean[ $key ] ) ) {
					$key .= '-' . substr( hash( 'sha256', strtolower( $label ) ), 0, 8 );
				}
				$clean[ $key ] = array(
					'key' => $key, 'label' => $label, 'aliases' => array(), 'option_ids' => array(), 'swatch' => '#5f656b', 'image_url' => $image,
				);
			}
		}
		return $clean;
	}

	private function normalise_vehicle_colour_label( string $value ): string {
		$value = strtolower( remove_accents( sanitize_text_field( $value ) ) );
		$value = preg_replace( '/^\s*premium\s+paint\s*[:\-]?\s*/i', '', $value );
		$value = str_replace( array( 'gray', 'color' ), array( 'grey', 'colour' ), (string) $value );
		$value = preg_replace( '/[^a-z0-9]+/', ' ', (string) $value );
		return trim( (string) preg_replace( '/\s+/', ' ', (string) $value ) );
	}

	/** @param array<string,array<string,mixed>> $catalog @return array<string,mixed>|null */
	private function match_vehicle_colour_signal( string $signal, array $catalog ): ?array {
		$option_signal = strtolower( trim( $signal ) );
		foreach ( $catalog as $definition ) {
			if ( in_array( $option_signal, array_map( 'strtolower', (array) $definition['option_ids'] ), true ) ) {
				return $definition;
			}
		}

		$label_signal = $this->normalise_vehicle_colour_label( $signal );
		if ( '' === $label_signal ) {
			return null;
		}
		foreach ( $catalog as $definition ) {
			$labels = array_merge( array( $definition['label'] ), (array) $definition['aliases'] );
			foreach ( $labels as $label ) {
				if ( $label_signal === $this->normalise_vehicle_colour_label( (string) $label ) ) {
					return $definition;
				}
			}
		}
		return null;
	}

	/** @return string[] */
	private function vehicle_configuration_signals( array $configuration ): array {
		$signals = array();
		$walk    = null;
		$walk    = static function ( mixed $value ) use ( &$walk, &$signals ): void {
			if ( is_array( $value ) ) {
				foreach ( $value as $key => $item ) {
					if ( is_string( $key ) && ! in_array( $item, array( false, null, '', 0, '0' ), true ) ) {
						$signals[] = $key;
					}
					$walk( $item );
				}
				return;
			}
			if ( is_scalar( $value ) && ! is_bool( $value ) ) {
				$signals[] = (string) $value;
			}
		};
		$walk( $configuration );
		return array_values( array_unique( array_filter( array_map( 'trim', $signals ) ) ) );
	}

	/** @param array<string,mixed> $configuration @return array<string,mixed>|null */
	private function vehicle_colour_definition( string $colour, array $configuration, object $row ): ?array {
		$catalog = $this->vehicle_colour_catalog( $row );
		if ( '' !== trim( $colour ) ) {
			$dedicated = $this->match_vehicle_colour_signal( $colour, $catalog );
			if ( $dedicated ) {
				return $dedicated;
			}
		}

		$matches = array();
		foreach ( $this->vehicle_configuration_signals( $configuration ) as $signal ) {
			$match = $this->match_vehicle_colour_signal( $signal, $catalog );
			if ( $match ) {
				$matches[ $match['key'] ] = $match;
			}
		}
		return 1 === count( $matches ) ? reset( $matches ) : null;
	}

	/** @param array<string,mixed> $vehicle @return array<string,mixed> */
	private function vehicle_build_data( object $row, array $vehicle ): array {
		$status     = strtolower( trim( (string) ( $row->order_status ?? '' ) ) );
		$current    = 0;
		$owned      = ! empty( $vehicle['is_owned'] );
		$stage_sets = array(
			4 => array( 'deliver', 'dispatch', 'collection', 'ready', 'owned', 'complete' ),
			3 => array( 'pdi', 'quality', 'inspection', 'testing', 'qc' ),
			2 => array( 'build', 'assembly', 'paint', 'production', 'manufactur' ),
			1 => array( 'allocat', 'configuration', 'specification', 'scheduled', 'slot' ),
		);
		foreach ( $stage_sets as $index => $needles ) {
			foreach ( $needles as $needle ) {
				if ( str_contains( $status, $needle ) ) {
					$current = $index;
					break 2;
				}
			}
		}
		if ( $owned ) {
			$current = 4;
		}

		$labels = array(
			__( 'Order confirmed', 'avenra-halo-v2' ),
			__( 'Specification allocated', 'avenra-halo-v2' ),
			__( 'In build', 'avenra-halo-v2' ),
			__( 'Inspection and testing', 'avenra-halo-v2' ),
			__( 'Ready for handover', 'avenra-halo-v2' ),
		);
		$steps = array();
		foreach ( $labels as $index => $label ) {
			$step_status = $index < $current || ( $owned && $index === $current ) ? 'complete' : ( $index === $current ? 'current' : 'upcoming' );
			$steps[] = array( 'id' => 'stage-' . ( $index + 1 ), 'label' => $label, 'status' => $step_status );
		}

		$build = array(
			'status'             => '' !== $status ? sanitize_key( $status ) : 'order-confirmed',
			'status_label'       => sanitize_text_field( (string) ( $row->order_status ?? $labels[ $current ] ) ),
			'current_label'      => $labels[ $current ],
			'current_stage'      => $current + 1,
			'progress_percent'   => $owned ? 100 : (int) round( ( $current / 4 ) * 100 ),
			'estimated_delivery' => $vehicle['estimated_delivery_date'] ?? null,
			'is_delayed'         => false,
			'steps'              => $steps,
			'timeline'           => $steps,
			'updated_at'         => $this->rfc3339( $row->updated_at ?? $row->order_date ?? null ),
		);
		return (array) apply_filters( 'avenra_halo_v2_vehicle_build', $build, $row, $vehicle, $this->auth->customer_id() );
	}

	/** @param array<string,mixed> $configuration */
	private function vehicle_estimated_delivery_date( object $row, array $configuration ): ?string {
		// A confirmed date attached to this order must always beat the historical
		// site-wide estimate. Support legacy column and JSON locations during migration.
		$candidates = array(
			$row->expected_delivery_date ?? null,
			$row->estimated_delivery_date ?? null,
			$configuration['expected_delivery_date'] ?? null,
			$configuration['estimated_delivery_date'] ?? null,
		);
		foreach ( $candidates as $candidate ) {
			if ( ! is_string( $candidate ) && ! is_int( $candidate ) ) {
				continue;
			}
			$order_date = $this->valid_date( (string) $candidate );
			if ( null !== $order_date ) {
				return $order_date;
			}
		}

		$legacy_estimate = time() <= strtotime( '2026-09-04 23:59:59 UTC' ) ? '2026-09-04' : '';
		$fallback = (string) apply_filters(
			'avenra_halo_v2_estimated_delivery_date',
			get_option( 'avenra_estimated_delivery_date', $legacy_estimate ),
			$row
		);
		return $this->valid_date( $fallback );
	}

	/** @return object[] */
	private function vehicle_rows(): array {
		global $wpdb;

		$table = $this->db->table( 'orders' );
		if ( ! $this->db->table_exists( $table ) ) {
			return array();
		}

		$order_by = $this->db->has_column( $table, 'order_date' ) ? 'order_date DESC, id DESC' : 'id DESC';
		return (array) $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $table ) . '` WHERE customer_id = %d ORDER BY ' . $order_by, // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$this->auth->customer_id()
			)
		);
	}

	/**
	 * Return the only configuration values that may be exposed to a rider.
	 *
	 * The order configuration also contains operational and commercial data.
	 * Ride-profile mappings are kept here for older Halo clients, but the raw
	 * configuration must never cross the customer REST boundary.
	 *
	 * @param array<string,mixed> $configuration
	 * @return array<string,string>
	 */
	private function public_ride_profile_configuration( array $configuration ): array {
		$profiles = array( 'Profile A', 'Profile B', 'Profile C', 'Profile D', 'Profile E' );
		$regens   = array( 'Off', 'Light', 'Medium', 'Heavy' );
		$public   = array();

		foreach ( array( 'mode_1', 'mode_2', 'mode_3' ) as $key ) {
			$raw   = $configuration[ $key ] ?? '';
			$value = is_string( $raw ) ? sanitize_text_field( $raw ) : '';
			if ( in_array( $value, $profiles, true ) ) {
				$public[ $key ] = $value;
			}
		}
		$raw_regen = $configuration['regen_profile'] ?? '';
		$regen     = is_string( $raw_regen ) ? sanitize_text_field( $raw_regen ) : '';
		if ( in_array( $regen, $regens, true ) ) {
			$public['regen_profile'] = $regen;
		}

		return $public;
	}

	/**
	 * Build the customer-facing specification from an exact public allowlist.
	 *
	 * Stored labels, prices and arbitrary configuration keys are deliberately
	 * ignored. Known option identifiers map to fixed rider-facing copy, so a
	 * nested audit object or future internal field cannot appear in Halo.
	 *
	 * @param array<string,mixed> $configuration
	 * @return array<int,array{key:string,label:string,value:string}>
	 */
	private function public_vehicle_specification( array $configuration, object $row ): array {
		$rows = array();
		$seen = array();
		$add  = function ( string $key, string $label, mixed $value ) use ( &$rows, &$seen ): void {
			if ( isset( $seen[ $key ] ) || ( ! is_string( $value ) && ! is_int( $value ) && ! is_float( $value ) ) ) {
				return;
			}
			$clean = $this->text_substr( sanitize_text_field( trim( (string) $value ) ), 0, 160 );
			if ( '' === $clean || '[object Object]' === $clean ) {
				return;
			}
			$seen[ $key ] = true;
			$rows[]       = array( 'key' => $key, 'label' => $label, 'value' => $clean );
		};
		$scalar = static function ( mixed $value ): string {
			return is_string( $value ) || is_int( $value ) || is_float( $value ) ? (string) $value : '';
		};

		$finish = strtolower( trim( $scalar( $configuration['colour_finish'] ?? '' ) ) );
		if ( 'personalised factory paint' === $finish ) {
			$add( 'finish', __( 'Finish', 'avenra-halo-v2' ), __( 'Personalised factory paint', 'avenra-halo-v2' ) );
		}

		$offer = $configuration['offer_code'] ?? $configuration['offer'] ?? '';
		if ( is_array( $offer ) ) {
			$offer = $offer['code'] ?? '';
		}
		if ( 'EVO-LAUNCH' === strtoupper( trim( $scalar( $offer ) ) ) ) {
			$add( 'offer', __( 'Offer', 'avenra-halo-v2' ), 'EVO-LAUNCH' );
		}

		$controller = strtolower( trim( $scalar( $configuration['controller'] ?? $configuration['controller_model'] ?? '' ) ) );
		if ( 'hypercore 1200' === $controller ) {
			$add( 'controller', __( 'Controller', 'avenra-halo-v2' ), 'HyperCore 1200' );
		}

		if ( true === ( $configuration['heated_grips'] ?? false ) || true === ( $configuration['heated_seat'] ?? false ) ) {
			$add( 'comfort', __( 'Comfort', 'avenra-halo-v2' ), __( 'Heated grips and seat', 'avenra-halo-v2' ) );
		}
		if ( true === ( $configuration['free_insurance'] ?? false ) ) {
			$add( 'insurance', __( 'Insurance', 'avenra-halo-v2' ), __( 'Included', 'avenra-halo-v2' ) );
		}

		$option_ids = array();
		$options    = $configuration['options'] ?? array();
		if ( is_array( $options ) ) {
			foreach ( $options as $option_key => $option_value ) {
				$option_id = is_int( $option_key ) ? $option_value : ( ! empty( $option_value ) ? $option_key : '' );
				if ( is_string( $option_id ) ) {
					$option_ids[] = sanitize_key( $option_id );
				}
			}
		}
		$line_items = $configuration['line_items'] ?? array();
		if ( is_array( $line_items ) ) {
			foreach ( $line_items as $line_item ) {
				if ( is_array( $line_item ) && is_string( $line_item['id'] ?? null ) ) {
					$option_ids[] = sanitize_key( $line_item['id'] );
				}
			}
		}

		$option_catalog = array(
			'opt_heated'           => array( 'comfort', __( 'Comfort', 'avenra-halo-v2' ), __( 'Heated grips and seat', 'avenra-halo-v2' ) ),
			'offer_free_insurance' => array( 'insurance', __( 'Insurance', 'avenra-halo-v2' ), __( 'Included', 'avenra-halo-v2' ) ),
			'opt_hypercore_1200'   => array( 'controller', __( 'Controller', 'avenra-halo-v2' ), 'HyperCore 1200' ),
			'opt_dash'             => array( 'display', __( 'Display', 'avenra-halo-v2' ), __( '6.5-inch dashboard upgrade', 'avenra-halo-v2' ) ),
			'opt_abs'              => array( 'abs', __( 'Braking', 'avenra-halo-v2' ), __( 'Anti-lock braking system', 'avenra-halo-v2' ) ),
			'opt_hel_calipers'     => array( 'hel_calipers', __( 'Braking', 'avenra-halo-v2' ), __( 'HEL brake calipers', 'avenra-halo-v2' ) ),
			'opt_hel_master'       => array( 'hel_master', __( 'Braking', 'avenra-halo-v2' ), __( 'HEL master cylinder', 'avenra-halo-v2' ) ),
			'opt_rims'             => array( 'rims', __( 'Wheels', 'avenra-halo-v2' ), __( 'Premium rims', 'avenra-halo-v2' ) ),
			'opt_track'            => array( 'track', __( 'Ride technology', 'avenra-halo-v2' ), __( 'Track mode', 'avenra-halo-v2' ) ),
			'opt_sentinel'         => array( 'sentinel', __( 'Security', 'avenra-halo-v2' ), 'Sentinel' ),
			'opt_sound'            => array( 'sound', __( 'Ride technology', 'avenra-halo-v2' ), __( 'Synthetic sound module', 'avenra-halo-v2' ) ),
			'opt_total_care'       => array( 'total_care', __( 'Care package', 'avenra-halo-v2' ), __( 'Avenrà Total Care', 'avenra-halo-v2' ) ),
			'opt_paint_custom'     => array( 'finish', __( 'Finish', 'avenra-halo-v2' ), __( 'Personalised factory paint', 'avenra-halo-v2' ) ),
		);
		foreach ( array_unique( $option_ids ) as $option_id ) {
			if ( isset( $option_catalog[ $option_id ] ) ) {
				$entry = $option_catalog[ $option_id ];
				$add( $entry[0], $entry[1], $entry[2] );
			}
		}

		$jacket_size = trim( $scalar( $row->apparel_jacket_size ?? $configuration['apparel_jacket_size'] ?? '' ) );
		if ( '' !== $jacket_size && preg_match( '/^[A-Za-z0-9 .-]{1,20}$/', $jacket_size ) ) {
			$add( 'jacket', __( 'Rider jacket', 'avenra-halo-v2' ), sprintf( __( 'Size %s', 'avenra-halo-v2' ), $jacket_size ) );
		}

		return array_slice( $rows, 0, 16 );
	}

	/** @return array<string,mixed> */
	private function serialise_vehicle( ?object $row ): array {
		if ( ! $row ) {
			return array();
		}

		$config       = json_decode( (string) ( $row->configuration_data ?? '' ), true );
		$config       = $this->safe_json_value( is_array( $config ) ? $config : array(), 100000 );
		$colour_input = trim( (string) ( $row->color ?? '' ) );
		$colour       = sanitize_text_field( '' !== $colour_input ? $colour_input : (string) ( $row->colour ?? '' ) );
		$definition   = $this->vehicle_colour_definition( $colour, is_array( $config ) ? $config : array(), $row );
		$colour_image = esc_url_raw( (string) ( $definition['image_url'] ?? '' ) );
		$legacy_image = esc_url_raw( (string) ( $row->custom_image ?? '' ) );
		// The canonical paint artwork is now the authoritative vehicle render.
		// A legacy configurator image remains a fallback; the rider private photo
		// is hydrated separately and still takes precedence in the signed-in app.
		$image        = '' !== $colour_image ? $colour_image : $legacy_image;
		$image        = esc_url_raw( (string) apply_filters( 'avenra_halo_v2_vehicle_image_url', $image, $row ) );
		$fallback     = '' !== $legacy_image ? $legacy_image : $colour_image;
		$private_photo          = $this->private_vehicle_photo_row( (int) $row->id );
		$private_photo_endpoint = $private_photo && $this->private_vehicle_photo_path( (string) $private_photo->storage_key )
			? '/vehicles/' . (int) $row->id . '/photo'
			: null;
		$status = sanitize_text_field( (string) ( $row->order_status ?? '' ) );
		$estimated = $this->vehicle_estimated_delivery_date( $row, is_array( $config ) ? $config : array() );
		$status_lower = strtolower( $status );
		$delivery_value = $row->delivery_date ?? $row->delivered_at ?? null;
		$pending_claim  = str_contains( $status_lower, 'ownership verification pending' ) || str_contains( $status_lower, 'verification pending' );
		$is_owned       = ! $pending_claim && ( (bool) preg_match( '/\b(owned|delivered|complete|approved)\b/', $status_lower ) || str_contains( $status_lower, 'ownership verified' ) || null !== $this->rfc3339( $delivery_value ) );

		$factory_profile       = $this->ride_profiles_from_order( $row );
		$public_configuration = $this->public_ride_profile_configuration( is_array( $config ) ? $config : array() );
		$public_specification = $this->public_vehicle_specification( is_array( $config ) ? $config : array(), $row );
		$vehicle = array(
			'id'                      => (int) $row->id,
			'model'                   => sanitize_text_field( (string) ( $row->model ?? '' ) ),
			'color'                   => $colour,
			'colour'                  => $colour,
			'colour_key'              => $definition['key'] ?? null,
			'colour_label'            => $definition['label'] ?? ( '' !== $colour ? $colour : null ),
			'colour_option_id'        => ! empty( $definition['option_ids'][0] ) ? $definition['option_ids'][0] : null,
			'colour_swatch'           => $definition['swatch'] ?? null,
			'colour_image_url'        => $colour_image ?: null,
			'image_url'               => $image ?: null,
			'fallback_image_url'      => $fallback ?: null,
			'private_photo_endpoint'  => $private_photo_endpoint,
			'has_private_photo'       => (bool) $private_photo_endpoint,
			'status'                  => $status,
			'status_label'            => $status,
			'is_owned'                => $is_owned,
			'order_date'              => $this->rfc3339( $row->order_date ?? null ),
			'delivery_date'           => $this->rfc3339( $delivery_value ),
			'delivered_at'            => $this->rfc3339( $delivery_value ),
			'estimated_delivery_date' => $estimated,
			'estimated_delivery'      => $estimated,
			'registration_plate'      => sanitize_text_field( (string) ( $row->registration_plate ?? '' ) ),
			'registration'            => sanitize_text_field( (string) ( $row->registration_plate ?? '' ) ),
			'vin'                     => sanitize_text_field( (string) ( $row->vin ?? '' ) ),
			'vin_masked'              => $this->mask_vin( sanitize_text_field( (string) ( $row->vin ?? '' ) ) ),
			'current_mileage'         => isset( $row->current_mileage ) ? (int) $row->current_mileage : null,
			'odometer_miles'          => isset( $row->current_mileage ) ? (int) $row->current_mileage : null,
			'first_registration_date' => $this->valid_date( (string) ( $row->first_registration_date ?? '' ) ),
			'last_service_date'       => $this->valid_date( (string) ( $row->last_service_date ?? '' ) ),
			'jacket_size'             => sanitize_text_field( (string) ( $row->apparel_jacket_size ?? '' ) ),
			'configuration'           => $public_configuration,
			'specification'           => $public_specification,
			'ride_profiles'           => $factory_profile,
			'ride_profile'            => $this->client_ride_profile( $factory_profile ),
		);
		$vehicle['build'] = $this->vehicle_build_data( $row, $vehicle );
		$vehicle['service'] = array(
			'status'       => $vehicle['last_service_date'] ? 'recorded' : 'not_scheduled',
			'status_label' => $vehicle['last_service_date'] ? __( 'Service recorded', 'avenra-halo-v2' ) : __( 'Not scheduled', 'avenra-halo-v2' ),
			'last_date'    => $vehicle['last_service_date'],
		);
		$vehicle['connection'] = array( 'connected' => false, 'status' => 'unavailable', 'source' => 'Halo vehicle record' );
		$vehicle['security']   = array( 'status' => 'unavailable', 'label' => __( 'Status unavailable', 'avenra-halo-v2' ) );
		$filtered = (array) apply_filters( 'avenra_halo_v2_vehicle_data', $vehicle, $row, $this->auth->customer_id() );
		// Enforce the customer data boundary after third-party filters as well.
		unset( $filtered['configuration_data'], $filtered['legacy_reconciliation_json'], $filtered['specs'] );
		$filtered['configuration'] = $public_configuration;
		$filtered['specification'] = $public_specification;
		return $filtered;
	}

	private function owned_order( int $id ): ?object {
		global $wpdb;

		if ( $id < 1 ) {
			return null;
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'orders' ) ) . '` WHERE id = %d AND customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$id,
				$this->auth->customer_id()
			)
		);
		return is_object( $row ) ? $row : null;
	}

	/** @return array<string,string> */
	private function ride_profiles_from_order( object $order ): array {
		$config = json_decode( (string) ( $order->configuration_data ?? '' ), true );
		$config = is_array( $config ) ? $config : array();
		return array(
			'mode_1'        => in_array( $config['mode_1'] ?? '', array( 'Profile A', 'Profile B', 'Profile C', 'Profile D', 'Profile E' ), true ) ? $config['mode_1'] : 'Profile A',
			'mode_2'        => in_array( $config['mode_2'] ?? '', array( 'Profile A', 'Profile B', 'Profile C', 'Profile D', 'Profile E' ), true ) ? $config['mode_2'] : 'Profile B',
			'mode_3'        => in_array( $config['mode_3'] ?? '', array( 'Profile A', 'Profile B', 'Profile C', 'Profile D', 'Profile E' ), true ) ? $config['mode_3'] : 'Profile E',
			'regen_profile' => in_array( $config['regen_profile'] ?? '', array( 'Off', 'Light', 'Medium', 'Heavy' ), true ) ? $config['regen_profile'] : 'Medium',
		);
	}

	/** @param array<string,string> $factory @return array<string,mixed> */
	private function client_ride_profile( array $factory ): array {
		$profile_map = array( 'Profile A' => 'eco', 'Profile B' => 'city', 'Profile C' => 'road', 'Profile D' => 'sport', 'Profile E' => 'sport' );
		$regen_map   = array( 'Off' => 'off', 'Light' => 'low', 'Medium' => 'medium', 'Heavy' => 'high' );
		$mappings = array(
			'mode_1' => $profile_map[ $factory['mode_1'] ?? '' ] ?? 'eco',
			'mode_2' => $profile_map[ $factory['mode_2'] ?? '' ] ?? 'road',
			'mode_3' => $profile_map[ $factory['mode_3'] ?? '' ] ?? 'sport',
		);
		return array(
			'handlebar_mappings' => $mappings,
			'modes'              => $mappings,
			'mode_1'             => $mappings['mode_1'],
			'mode_2'             => $mappings['mode_2'],
			'mode_3'             => $mappings['mode_3'],
			'regeneration'       => $regen_map[ $factory['regen_profile'] ?? '' ] ?? 'medium',
			'regen'              => $regen_map[ $factory['regen_profile'] ?? '' ] ?? 'medium',
			'track_available'    => false,
		);
	}

	/** @return array<int,array<string,mixed>> */
	private function legacy_rides(): array {
		if ( null !== $this->legacy_rides_cache ) {
			return $this->legacy_rides_cache;
		}

		$source = apply_filters( 'avenra_halo_v2_legacy_rides', null, $this->auth->customer_id() );
		if ( ! is_array( $source ) ) {
			$source = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch( 'get_avenra_rides', array(), $this->auth->customer_id() );
		}
		if ( is_wp_error( $source ) ) {
			$this->legacy_rides_cache = array();
			return array();
		}
		if ( isset( $source['success'] ) && is_array( $source['data'] ?? null ) ) {
			$source = $source['data'];
		}
		$rows = $source['rides'] ?? $source['items'] ?? $source;
		if ( ! is_array( $rows ) ) {
			$this->legacy_rides_cache = array();
			return array();
		}

		$rides = array();
		foreach ( array_slice( $rows, 0, 500 ) as $index => $raw ) {
			$row = is_object( $raw ) ? get_object_vars( $raw ) : $raw;
			if ( ! is_array( $row ) ) {
				continue;
			}
			$route = $this->normalise_route( $row['route_json'] ?? $row['route'] ?? array(), 'latlng' );
			$first = $route ? $route[0] : array();
			$last  = $route ? $route[ count( $route ) - 1 ] : array();
			$source_id = sanitize_text_field( (string) ( $row['id'] ?? $row['ride_id'] ?? $index ) );
			$id = 'legacy-' . substr( preg_replace( '/[^A-Za-z0-9._:-]/', '-', $source_id ), 0, 60 );
			if ( 'legacy-' === $id ) {
				$id .= substr( hash( 'sha256', wp_json_encode( $row ) ), 0, 16 );
			}
			$started = $this->rfc3339( $row['started_at'] ?? $row['ride_date'] ?? $row['created_at'] ?? null );
			$duration = min( 7 * DAY_IN_SECONDS, max( 0, absint( $row['duration_seconds'] ?? $row['duration_secs'] ?? 0 ) ) );
			$ended = $this->rfc3339( $row['ended_at'] ?? null );
			if ( ! $ended && $started && $duration ) {
				$ended = gmdate( DATE_RFC3339, strtotime( $started ) + $duration );
			}
			$max_left  = (float) $this->number( $row['max_lean_left'] ?? 0, 0, 90, 0 );
			$max_right = (float) $this->number( $row['max_lean_right'] ?? 0, 0, 90, 0 );
			$rides[] = array(
				'id'                 => $id,
				'legacy_id'          => $source_id,
				'source'             => 'legacy',
				'client_ride_id'     => null,
				'vehicle_order_id'   => isset( $row['vehicle_order_id'] ) ? absint( $row['vehicle_order_id'] ) : null,
				'started_at'         => $started,
				'ended_at'           => $ended,
				'ride_date'          => $started,
				'date'               => $started,
				'duration_seconds'   => $duration,
				'duration_secs'      => $duration,
				'distance_miles'     => (float) $this->number( $row['distance_miles'] ?? 0, 0, 5000, 0 ),
				'energy_wh'          => null,
				'energy_kwh'         => isset( $row['energy_kwh'] ) ? $this->number( $row['energy_kwh'], 0, 500, null ) : null,
				'average_speed_mph'  => $this->number( $row['average_speed_mph'] ?? null, 0, 250, null ),
				'top_speed_mph'      => (float) $this->number( $row['top_speed_mph'] ?? 0, 0, 250, 0 ),
				'best_zero_to_sixty' => $this->nullable_performance( $row['best_zero_to_sixty'] ?? $row['best_0_60'] ?? null ),
				'best_0_60'          => $this->nullable_performance( $row['best_zero_to_sixty'] ?? $row['best_0_60'] ?? null ),
				'max_lean_left'      => $max_left,
				'max_lean_right'     => $max_right,
				'max_lean_degrees'   => max( $max_left, $max_right ),
				'start_lat'          => $this->coordinate( $row['start_lat'] ?? $first[1] ?? null, -90, 90 ),
				'start_lng'          => $this->coordinate( $row['start_lng'] ?? $first[0] ?? null, -180, 180 ),
				'end_lat'            => $this->coordinate( $row['end_lat'] ?? $last[1] ?? null, -90, 90 ),
				'end_lng'            => $this->coordinate( $row['end_lng'] ?? $last[0] ?? null, -180, 180 ),
				'start_location'     => $this->text_substr( sanitize_text_field( (string) ( $row['start_location'] ?? '' ) ), 0, 255 ),
				'end_location'       => $this->text_substr( sanitize_text_field( (string) ( $row['end_location'] ?? '' ) ), 0, 255 ),
				'route'              => $route,
				'route_json'         => wp_json_encode( $route ),
				'status'             => 'complete',
				'title'              => ! empty( $row['end_location'] ) ? sanitize_text_field( (string) $row['end_location'] ) : __( 'Recorded ride', 'avenra-halo-v2' ),
				'destination'        => sanitize_text_field( (string) ( $row['end_location'] ?? '' ) ),
				'details_loaded'     => true,
				'share_endpoint'     => '/rides/' . rawurlencode( $id ) . '/share',
			);
		}

		$this->legacy_rides_cache = $rides;
		return $rides;
	}

	/** @return array<string,mixed>|null */
	private function legacy_ride( string $id ): ?array {
		foreach ( $this->legacy_rides() as $ride ) {
			if ( hash_equals( (string) $ride['id'], $id ) ) {
				return $ride;
			}
		}
		return null;
	}

	/** @return array<string,mixed> */
	private function serialise_ride( object $row ): array {
		$route = json_decode( (string) ( $row->route_json ?? '' ), true );
		$route = $this->normalise_route( is_array( $route ) ? $route : array(), 'geojson' );
		$max_lean = max( (float) $row->max_lean_left, (float) $row->max_lean_right );
		$ride = array(
			'id'                   => (string) $row->public_id,
			'database_id'          => (int) $row->id,
			'client_ride_id'       => $row->client_ride_id ?: null,
			'vehicle_order_id'     => $row->vehicle_order_id ? (int) $row->vehicle_order_id : null,
			'started_at'           => $this->rfc3339( $row->started_at ),
			'ended_at'             => $this->rfc3339( $row->ended_at ),
			'ride_date'            => $this->rfc3339( $row->started_at ),
			'duration_seconds'     => (int) $row->duration_seconds,
			'duration_secs'        => (int) $row->duration_seconds,
			'distance_miles'       => (float) $row->distance_miles,
			'energy_wh'            => null !== $row->energy_wh ? (float) $row->energy_wh : null,
			'energy_kwh'           => null !== $row->energy_wh ? round( (float) $row->energy_wh / 1000, 3 ) : null,
			'average_speed_mph'    => null !== $row->average_speed_mph ? (float) $row->average_speed_mph : null,
			'top_speed_mph'        => (float) $row->top_speed_mph,
			'best_zero_to_sixty'   => null !== $row->best_zero_to_sixty ? (float) $row->best_zero_to_sixty : null,
			'best_0_60'            => null !== $row->best_zero_to_sixty ? (float) $row->best_zero_to_sixty : null,
			'max_lean_left'        => (float) $row->max_lean_left,
			'max_lean_right'       => (float) $row->max_lean_right,
			'max_lean_degrees'     => $max_lean,
			'ride_mode'            => '' !== (string) ( $row->ride_mode ?? '' ) ? sanitize_key( (string) $row->ride_mode ) : null,
			'peak_g_force'         => null !== ( $row->peak_g_force ?? null ) ? (float) $row->peak_g_force : null,
			'harsh_event_count'    => (int) ( $row->harsh_event_count ?? 0 ),
			'telemetry_quality'    => '' !== (string) ( $row->telemetry_quality ?? '' ) ? sanitize_key( (string) $row->telemetry_quality ) : null,
			'start_lat'            => null !== $row->start_lat ? (float) $row->start_lat : null,
			'start_lng'            => null !== $row->start_lng ? (float) $row->start_lng : null,
			'end_lat'              => null !== $row->end_lat ? (float) $row->end_lat : null,
			'end_lng'              => null !== $row->end_lng ? (float) $row->end_lng : null,
			'start_location'       => (string) $row->start_location,
			'end_location'         => (string) $row->end_location,
			'route'                => $route,
			'route_json'           => wp_json_encode( $route ),
			'status'               => sanitize_key( (string) $row->status ),
			'date'                 => $this->rfc3339( $row->started_at ),
			'title'                => $row->end_location ? sanitize_text_field( (string) $row->end_location ) : __( 'Recorded ride', 'avenra-halo-v2' ),
			'destination'          => sanitize_text_field( (string) $row->end_location ),
			'details_loaded'       => true,
		);
		return $ride;
	}

	private function owned_ride( string $id ): ?object {
		global $wpdb;

		$table = $this->db->table( 'rides' );
		if ( ctype_digit( $id ) ) {
			$sql = $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $table ) . '` WHERE id = %d AND customer_id = %d LIMIT 1', (int) $id, $this->auth->customer_id() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		} else {
			$sql = $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $table ) . '` WHERE public_id = %s AND customer_id = %d LIMIT 1', sanitize_text_field( $id ), $this->auth->customer_id() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
		$row = $wpdb->get_row( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	/** @return array<string,mixed> */
	private function ride_summary(): array {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT COUNT(*) AS ride_count, COALESCE(SUM(distance_miles),0) AS total_miles, COALESCE(SUM(duration_seconds),0) AS duration_seconds, COALESCE(MAX(top_speed_mph),0) AS top_speed_mph, COALESCE(MAX(GREATEST(max_lean_left,max_lean_right)),0) AS max_lean FROM `' . esc_sql( $this->db->table( 'rides' ) ) . '` WHERE customer_id = %d', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$this->auth->customer_id()
			)
		);
		$legacy = $this->legacy_rides();
		$legacy_miles = array_sum( array_map( static fn( array $ride ): float => (float) $ride['distance_miles'], $legacy ) );
		$legacy_duration = array_sum( array_map( static fn( array $ride ): int => (int) $ride['duration_seconds'], $legacy ) );
		$legacy_speed = $legacy ? max( array_map( static fn( array $ride ): float => (float) $ride['top_speed_mph'], $legacy ) ) : 0;
		$legacy_lean = $legacy ? max( array_map( static fn( array $ride ): float => (float) $ride['max_lean_degrees'], $legacy ) ) : 0;
		$total_miles = (float) ( $row->total_miles ?? 0 ) + $legacy_miles;
		return array(
			'ride_count'    => (int) ( $row->ride_count ?? 0 ) + count( $legacy ),
			'total_miles'   => $total_miles,
			'distance_miles'=> $total_miles,
			'duration_seconds' => (int) ( $row->duration_seconds ?? 0 ) + $legacy_duration,
			'top_speed_mph' => max( (float) ( $row->top_speed_mph ?? 0 ), $legacy_speed ),
			'max_lean'      => max( (float) ( $row->max_lean ?? 0 ), $legacy_lean ),
		);
	}

	/** @return array<string,mixed> */
	private function serialise_hazard( object $row ): array {
		return array(
			'id'            => (string) $row->public_id,
			'type'          => sanitize_text_field( (string) $row->hazard_type ),
			'hazard_type'   => sanitize_text_field( (string) $row->hazard_type ),
			'severity'      => (int) $row->severity,
			'latitude'      => (float) $row->latitude,
			'longitude'     => (float) $row->longitude,
			'lat'           => (float) $row->latitude,
			'lng'           => (float) $row->longitude,
			'note'          => sanitize_text_field( (string) $row->note ),
			'status'        => sanitize_key( (string) $row->status ),
			'confirmations' => (int) $row->confirmations,
			'disputes'      => (int) $row->disputes,
			'reported_at'   => $this->rfc3339( $row->reported_at ),
			'expires_at'    => $this->rfc3339( $row->expires_at ),
		);
	}

	/** @return array<string,mixed> */
	private function serialise_document( object $row ): array {
		return array(
			'id'               => (string) $row->public_id,
			'database_id'      => (int) $row->id,
			'vehicle_order_id' => $row->vehicle_order_id ? (int) $row->vehicle_order_id : null,
			'document_type'    => sanitize_key( (string) $row->document_type ),
			'title'            => sanitize_text_field( (string) $row->title ),
			'filename'         => sanitize_file_name( (string) $row->original_filename ),
			'mime_type'        => sanitize_mime_type( (string) $row->mime_type ),
			'file_size'        => (int) $row->file_size,
			'issued_at'        => $this->valid_date( (string) $row->issued_at ),
			'expires_at'       => $this->valid_date( (string) $row->expires_at ),
			'created_at'       => $this->rfc3339( $row->created_at ),
			'download_url'     => rest_url( self::NS . '/documents/' . rawurlencode( (string) $row->public_id ) . '/download' ),
		);
	}

	private function owned_document( string $id ): ?object {
		global $wpdb;

		$table = $this->db->table( 'documents' );
		if ( ctype_digit( $id ) ) {
			$sql = $wpdb->prepare( "SELECT * FROM `" . esc_sql( $table ) . "` WHERE id = %d AND customer_id = %d AND status = 'active' LIMIT 1", (int) $id, $this->auth->customer_id() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		} else {
			$sql = $wpdb->prepare( "SELECT * FROM `" . esc_sql( $table ) . "` WHERE public_id = %s AND customer_id = %d AND status = 'active' LIMIT 1", sanitize_text_field( $id ), $this->auth->customer_id() ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
		$row = $wpdb->get_row( $sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function private_vehicle_photo_row( int $vehicle_order_id ): ?object {
		global $wpdb;

		if ( $vehicle_order_id < 1 || $this->auth->customer_id() < 1 ) {
			return null;
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'vehicle_photos' ) ) . '` WHERE vehicle_order_id = %d AND customer_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$vehicle_order_id,
				$this->auth->customer_id()
			)
		);
		return is_object( $row ) ? $row : null;
	}

	private function vehicle_photo_row_for_order( int $vehicle_order_id ): ?object {
		global $wpdb;

		if ( $vehicle_order_id < 1 ) {
			return null;
		}
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'vehicle_photos' ) ) . '` WHERE vehicle_order_id = %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$vehicle_order_id
			)
		);
		return is_object( $row ) ? $row : null;
	}

	private function private_vehicle_photo_path( string $storage_key ): ?string {
		if ( ! preg_match( '#^vehicle-\d+/\d+/[A-Za-z0-9_-]{20,90}\.(?:jpe?g|png|webp)$#i', $storage_key ) ) {
			return null;
		}
		$uploads = wp_upload_dir();
		$root    = realpath( trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private' );
		$path    = realpath( trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private/' . $storage_key );
		if ( ! $root || ! $path || ! str_starts_with( $path, trailingslashit( $root ) ) || ! is_file( $path ) ) {
			return null;
		}
		return $path;
	}

	private function remove_legacy_public_vehicle_photos( object $order, int $customer_id ): void {
		global $wpdb;

		$order_attachment_ids = array_map(
			'absint',
			get_posts(
				array(
					'post_type'      => 'attachment',
					'post_status'    => 'any',
					'posts_per_page' => -1,
					'fields'         => 'ids',
					'no_found_rows'  => true,
					'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
						array( 'key' => '_avenra_halo_v2_vehicle_photo_order_id', 'value' => (string) (int) $order->id ),
					),
				)
			)
		);
		$order_attachment_ids = array_values( array_filter( array_unique( $order_attachment_ids ) ) );
		$attachment_ids       = array_values(
			array_filter(
				$order_attachment_ids,
				static function ( int $attachment_id ): bool {
					$marked_customer_id = get_post_meta( $attachment_id, '_avenra_halo_v2_vehicle_photo_customer_id', true );
					return is_scalar( $marked_customer_id ) && ctype_digit( (string) $marked_customer_id ) && absint( $marked_customer_id ) > 0;
				}
			)
		);
		if ( ! $attachment_ids ) {
			return;
		}

		$order_table = $this->db->table( 'orders' );
		$clear                = array( 'updated_at' => current_time( 'mysql', true ) );
		$has_legacy_reference = false;
		if ( in_array( absint( $order->custom_image_attachment_id ?? 0 ), $attachment_ids, true ) ) {
			$clear['custom_image_attachment_id'] = 0;
			$has_legacy_reference                = true;
		}
		$image_attachment_id = ! empty( $order->custom_image ) ? attachment_url_to_postid( (string) $order->custom_image ) : 0;
		if ( $image_attachment_id && in_array( (int) $image_attachment_id, $attachment_ids, true ) ) {
			$clear['custom_image'] = '';
			$has_legacy_reference  = true;
		}
		$clear = $this->db->supported_data( $order_table, $clear );
		if ( $has_legacy_reference && $clear && false === $wpdb->update( $order_table, $clear, array( 'id' => (int) $order->id, 'customer_id' => $customer_id ) ) ) {
			do_action( 'avenra_halo_v2_vehicle_photo_legacy_reference_cleanup_error', (int) $order->id, $customer_id );
		}

		foreach ( $attachment_ids as $attachment_id ) {
			if ( ! wp_delete_attachment( $attachment_id, true ) ) {
				do_action( 'avenra_halo_v2_vehicle_photo_cleanup_error', $attachment_id, (int) $order->id, $customer_id );
			}
		}
	}

	private function private_document_path( string $storage_key ): ?string {
		if ( ! preg_match( '#^[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$#', $storage_key ) ) {
			return null;
		}
		$uploads = wp_upload_dir();
		$root    = realpath( trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private' );
		$path    = realpath( trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private/' . $storage_key );
		if ( ! $root || ! $path || ! str_starts_with( $path, trailingslashit( $root ) ) || ! is_file( $path ) ) {
			return null;
		}
		return $path;
	}

	/**
	 * @param array{south:float,west:float,north:float,east:float} $bounds
	 * @return array{available:bool,historical_zones:array<int,array<string,mixed>>,community_hazards:array<int,array<string,mixed>>}
	 */
	private function load_focus_zones( array $bounds ): array {
		$source = apply_filters( 'avenra_halo_v2_focus_zones', null, $bounds, $this->auth->customer_id() );
		if ( ! is_array( $source ) ) {
			$source = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch(
				'get_avenra_focus_zones',
				array( 'n' => $bounds['north'], 's' => $bounds['south'], 'e' => $bounds['east'], 'w' => $bounds['west'] ),
				$this->auth->customer_id()
			);
		}
		if ( is_wp_error( $source ) ) {
			return array( 'available' => false, 'historical_zones' => array(), 'community_hazards' => array() );
		}
		if ( isset( $source['success'] ) ) {
			if ( ! $source['success'] || ! is_array( $source['data'] ?? null ) ) {
				return array( 'available' => false, 'historical_zones' => array(), 'community_hazards' => array() );
			}
			$source = $source['data'];
		}

		$historical = array();
		foreach ( (array) ( $source['historical_zones'] ?? array() ) as $zone ) {
			if ( ! is_array( $zone ) ) {
				continue;
			}
			$lat = $this->coordinate( $zone['lat'] ?? $zone['latitude'] ?? null, -90, 90 );
			$lng = $this->coordinate( $zone['lng'] ?? $zone['longitude'] ?? null, -180, 180 );
			if ( null === $lat || null === $lng || $lat < $bounds['south'] || $lat > $bounds['north'] || $lng < $bounds['west'] || $lng > $bounds['east'] ) {
				continue;
			}
			$historical[] = array(
				'id'             => 'historical-' . substr( hash( 'sha256', $lat . '|' . $lng . '|' . ( $zone['label'] ?? '' ) ), 0, 16 ),
				'lat'            => $lat,
				'lng'            => $lng,
				'radius_m'       => min( 1000, max( 25, absint( $zone['radius_m'] ?? $zone['radius'] ?? 140 ) ) ),
				'incident_count' => min( 999, max( 1, absint( $zone['incident_count'] ?? $zone['count'] ?? 1 ) ) ),
				'label'          => $this->text_substr( sanitize_text_field( (string) ( $zone['label'] ?? 'Historical focus zone' ) ), 0, 120 ),
				'advisory'       => true,
			);
			if ( count( $historical ) >= 250 ) {
				break;
			}
		}

		$community = array();
		foreach ( (array) ( $source['community_hazards'] ?? array() ) as $hazard ) {
			if ( ! is_array( $hazard ) ) {
				continue;
			}
			$lat  = $this->coordinate( $hazard['lat'] ?? $hazard['latitude'] ?? null, -90, 90 );
			$lng  = $this->coordinate( $hazard['lng'] ?? $hazard['longitude'] ?? null, -180, 180 );
			$type = $this->text_substr( sanitize_text_field( (string) ( $hazard['hazard_type'] ?? $hazard['type'] ?? 'Road hazard' ) ), 0, 48 );
			if ( null === $lat || null === $lng || $lat < $bounds['south'] || $lat > $bounds['north'] || $lng < $bounds['west'] || $lng > $bounds['east'] ) {
				continue;
			}
			$community[] = array(
				'id'          => 'legacy-' . substr( hash( 'sha256', $type . '|' . $lat . '|' . $lng ), 0, 16 ),
				'type'        => $type,
				'hazard_type' => $type,
				'severity'    => min( 3, max( 1, absint( $hazard['severity'] ?? 2 ) ) ),
				'latitude'    => $lat,
				'longitude'   => $lng,
				'lat'         => $lat,
				'lng'         => $lng,
				'note'        => '',
				'status'      => 'active',
				'confirmations'=> 0,
				'disputes'    => 0,
				'reported_at' => null,
				'expires_at'  => null,
			);
			if ( count( $community ) >= 250 ) {
				break;
			}
		}

		return array( 'available' => true, 'historical_zones' => $historical, 'community_hazards' => $community );
	}

	/**
	 * @param array<string,mixed> $payload
	 * @return array<string,mixed>|WP_Error
	 */
	private function perform_nok_safety_alert( string $kind, array $payload, object $customer, string $legacy_action ): array|WP_Error {
		$customer_id = (int) ( $customer->id ?? 0 );
		$lock = $this->db->acquire_advisory_lock( 'emergency-safety-consent', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return new WP_Error( 'emergency_safety_consent_busy', __( 'Safety information is being updated. Please retry the alert.', 'avenra-halo-v2' ) );
		}
		try {
			$fresh_customer = $customer_id > 0 ? $this->db->customer_by_id( $customer_id ) : null;
			if ( ! is_object( $fresh_customer ) || empty( $fresh_customer->nok_mobile ) || ! Avenra_Halo_V2_Emergency::instance()->has_nok_alert_consent( $customer_id ) ) {
				return new WP_Error( 'nok_alert_not_enabled', __( 'Next-of-kin alerts are not enabled on this profile.', 'avenra-halo-v2' ) );
			}
			return $this->perform_safety_alert( $kind, $payload, $fresh_customer, $legacy_action );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	/**
	 * @param array<string,mixed> $payload
	 * @return array<string,mixed>|WP_Error
	 */
	private function perform_safety_alert( string $kind, array $payload, object $customer, string $legacy_action ): array|WP_Error {
		$result = apply_filters( 'avenra_halo_v2_safety_alert_result', null, $kind, $payload, $customer );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( is_array( $result ) ) {
			$sent = true === ( $result['sent'] ?? null ) || true === ( $result['success'] ?? null );
			if ( ! $sent ) {
				return new WP_Error( 'alert_provider_failed', __( 'The alert provider did not accept the message.', 'avenra-halo-v2' ) );
			}
			return $result;
		}

		$legacy = Avenra_Halo_V2_Legacy_Bridge::instance()->dispatch( $legacy_action, $payload, (int) $customer->id );
		if ( is_wp_error( $legacy ) ) {
			return new WP_Error( 'alert_provider_unavailable', __( 'The next-of-kin alert service is temporarily unavailable.', 'avenra-halo-v2' ) );
		}
		$success = ! empty( $legacy['success'] ) || 'ok' === ( $legacy['status'] ?? '' ) || ! empty( $legacy['data']['sent'] );
		if ( ! $success ) {
			return new WP_Error( 'alert_provider_failed', sanitize_text_field( (string) ( $legacy['message'] ?? $legacy['data']['message'] ?? __( 'The alert provider did not accept the message.', 'avenra-halo-v2' ) ) ) );
		}
		return $legacy;
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

	private function request_ip(): string {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
		return (string) apply_filters( 'avenra_halo_v2_client_ip', $ip );
	}

	private function consume_rate_limit( string $scope, string $identifier, int $limit, int $window ): bool {
		$scope  = sanitize_key( $scope );
		$limit  = max( 1, (int) apply_filters( 'avenra_halo_v2_rate_limit_' . str_replace( '-', '_', $scope ), $limit ) );
		$window = max( MINUTE_IN_SECONDS, $window );
		return $this->db->consume_rate_limit( $scope, $identifier, $limit, $window );
	}

	/** Build the same explicit Google Maps route share used by Halo V1. */
	private function ride_route_share_url( array $ride ): ?string {
		$route = $this->normalise_route( $ride['route'] ?? $ride['route_json'] ?? array(), 'geojson' );
		if ( count( $route ) >= 2 ) {
			$start = $route[0];
			$end   = $route[ count( $route ) - 1 ];
		} else {
			$start_lat = $this->coordinate( $ride['start_lat'] ?? null, -90, 90 );
			$start_lng = $this->coordinate( $ride['start_lng'] ?? null, -180, 180 );
			$end_lat   = $this->coordinate( $ride['end_lat'] ?? null, -90, 90 );
			$end_lng   = $this->coordinate( $ride['end_lng'] ?? null, -180, 180 );
			if ( null === $start_lat || null === $start_lng || null === $end_lat || null === $end_lng ) {
				return null;
			}
			$start = array( $start_lng, $start_lat );
			$end   = array( $end_lng, $end_lat );
		}

		$args = array(
			'api'         => '1',
			'origin'      => number_format( (float) $start[1], 6, '.', '' ) . ',' . number_format( (float) $start[0], 6, '.', '' ),
			'destination' => number_format( (float) $end[1], 6, '.', '' ) . ',' . number_format( (float) $end[0], 6, '.', '' ),
			'travelmode'  => 'driving',
		);
		if ( count( $route ) > 10 ) {
			$middle = $route[ (int) floor( count( $route ) / 2 ) ];
			$args['waypoints'] = number_format( (float) $middle[1], 6, '.', '' ) . ',' . number_format( (float) $middle[0], 6, '.', '' );
		}
		$url = add_query_arg( $args, 'https://www.google.com/maps/dir/' );
		$url = apply_filters( 'avenra_halo_v2_ride_share_url', $url, $ride );
		$url = is_string( $url ) ? esc_url_raw( $url ) : '';
		return '' !== $url ? $url : null;
	}

	/** Count Unicode characters when mbstring is available, bytes otherwise. */
	private function text_length( string $value ): int {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $value, 'UTF-8' ) : strlen( $value );
	}

	/** Truncate Unicode text when mbstring is available, with a core PHP fallback. */
	private function text_substr( string $value, int $start, int $length ): string {
		return function_exists( 'mb_substr' ) ? mb_substr( $value, $start, $length, 'UTF-8' ) : substr( $value, $start, $length );
	}

	private function boolean( mixed $value ): bool {
		if ( is_bool( $value ) ) {
			return $value;
		}
		return in_array( strtolower( trim( (string) $value ) ), array( '1', 'true', 'yes', 'on' ), true );
	}

	private function valid_date( string $value ): ?string {
		$value = trim( $value );
		if ( '' === $value || '0000-00-00' === $value ) {
			return null;
		}
		$date = DateTimeImmutable::createFromFormat( '!Y-m-d', substr( $value, 0, 10 ) );
		return $date && $date->format( 'Y-m-d' ) === substr( $value, 0, 10 ) ? $date->format( 'Y-m-d' ) : null;
	}

	private function normalise_datetime( string $value ): ?string {
		$value = trim( $value );
		if ( '' === $value || str_starts_with( $value, '0000-00-00' ) ) {
			return null;
		}
		try {
			$date = new DateTimeImmutable( $value, new DateTimeZone( 'UTC' ) );
			return $date->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' );
		} catch ( Throwable $error ) {
			return null;
		}
	}

	private function rfc3339( mixed $value ): ?string {
		if ( null === $value || '' === trim( (string) $value ) || str_starts_with( (string) $value, '0000-00-00' ) ) {
			return null;
		}
		$timestamp = strtotime( (string) $value . ( preg_match( '/(?:Z|[+-]\d{2}:?\d{2})$/', (string) $value ) ? '' : ' UTC' ) );
		return false !== $timestamp ? gmdate( DATE_RFC3339, $timestamp ) : null;
	}

	private function number( mixed $value, float $min, float $max, ?float $default ): ?float {
		if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
			return $default;
		}
		return min( $max, max( $min, (float) $value ) );
	}

	private function coordinate( mixed $value, float $min, float $max ): ?float {
		if ( null === $value || '' === $value || ! is_numeric( $value ) ) {
			return null;
		}
		$value = (float) $value;
		return $value >= $min && $value <= $max ? round( $value, 7 ) : null;
	}

	private function nullable_performance( mixed $value ): ?float {
		if ( null === $value || '' === $value || 'null' === strtolower( (string) $value ) ) {
			return null;
		}
		return $this->number( $value, 0.5, 120, null );
	}

	private function nullable_sql_number( mixed $value, float $min, float $max ): ?string {
		$number = $this->number( $value, $min, $max, null );
		return null === $number ? null : (string) $number;
	}

	/**
	 * Return canonical GeoJSON coordinate order: [longitude, latitude]. Object
	 * points are unambiguous; array points default to GeoJSON but an explicit
	 * latlng hint is used while importing V1 Leaflet histories.
	 *
	 * @return array<int,array<int,float|int>>
	 */
	private function normalise_route( mixed $route, string $array_order = 'geojson' ): array {
		if ( is_string( $route ) ) {
			$route = json_decode( $route, true );
		}
		if ( ! is_array( $route ) ) {
			return array();
		}
		if ( is_array( $route['geometry'] ?? null ) ) {
			$route = $route['geometry'];
		}
		if ( is_array( $route['coordinates'] ?? null ) ) {
			$route = $route['coordinates'];
		} elseif ( is_array( $route['points'] ?? null ) ) {
			$route = $route['points'];
		}

		$maximum = min( 10000, max( 100, (int) apply_filters( 'avenra_halo_v2_max_route_points', 5000 ) ) );
		if ( count( $route ) > $maximum ) {
			$step  = (int) ceil( count( $route ) / $maximum );
			$route = array_values( array_filter( $route, static fn( mixed $point, int $index ): bool => 0 === $index % $step, ARRAY_FILTER_USE_BOTH ) );
		}

		$clean = array();
		foreach ( $route as $point ) {
			if ( ! is_array( $point ) ) {
				continue;
			}
			$has_named_coordinates = array_key_exists( 'lat', $point ) || array_key_exists( 'latitude', $point ) || array_key_exists( 'lng', $point ) || array_key_exists( 'longitude', $point );
			if ( $has_named_coordinates ) {
				$lat = $this->coordinate( $point['lat'] ?? $point['latitude'] ?? null, -90, 90 );
				$lng = $this->coordinate( $point['lng'] ?? $point['longitude'] ?? null, -180, 180 );
			} else {
				$first  = $point[0] ?? null;
				$second = $point[1] ?? null;
				// Values outside latitude range make the order self-identifying.
				if ( is_numeric( $first ) && abs( (float) $first ) > 90 ) {
					$lng = $this->coordinate( $first, -180, 180 );
					$lat = $this->coordinate( $second, -90, 90 );
				} elseif ( is_numeric( $second ) && abs( (float) $second ) > 90 ) {
					$lat = $this->coordinate( $first, -90, 90 );
					$lng = $this->coordinate( $second, -180, 180 );
				} elseif ( 'latlng' === $array_order ) {
					$lat = $this->coordinate( $first, -90, 90 );
					$lng = $this->coordinate( $second, -180, 180 );
				} else {
					$lng = $this->coordinate( $first, -180, 180 );
					$lat = $this->coordinate( $second, -90, 90 );
				}
			}
			if ( null === $lat || null === $lng ) {
				continue;
			}
			$item = array( $lng, $lat );
			$timestamp = $point['timestamp'] ?? $point['at'] ?? $point[2] ?? null;
			if ( is_numeric( $timestamp ) ) {
				$item[] = (int) $timestamp;
			}
			$clean[] = $item;
		}
		return $clean;
	}

	private function safe_json_value( mixed $value, int $max_bytes ): mixed {
		if ( is_string( $value ) ) {
			$decoded = json_decode( $value, true );
			$value   = JSON_ERROR_NONE === json_last_error() ? $decoded : sanitize_text_field( $value );
		}
		$clean = $this->sanitise_nested( $value, 0 );
		$json  = wp_json_encode( $clean );
		if ( is_string( $json ) && strlen( $json ) > $max_bytes ) {
			return array();
		}
		return $clean;
	}

	private function sanitise_nested( mixed $value, int $depth ): mixed {
		if ( $depth > 8 ) {
			return null;
		}
		if ( is_array( $value ) ) {
			$output = array();
			$count  = 0;
			foreach ( $value as $key => $item ) {
				if ( ++$count > 500 ) {
					break;
				}
				$clean_key = is_int( $key ) ? $key : sanitize_key( (string) $key );
				$output[ $clean_key ] = $this->sanitise_nested( $item, $depth + 1 );
			}
			return $output;
		}
		if ( is_string( $value ) ) {
			return $this->text_substr( sanitize_text_field( $value ), 0, 1000 );
		}
		if ( is_int( $value ) || is_float( $value ) || is_bool( $value ) || null === $value ) {
			return $value;
		}
		return null;
	}

	/** @param array<string,mixed> $payload */
	private function directions_fallback_url( array $payload ): string {
		$origin = null !== $payload['start_lat'] && null !== $payload['start_lng']
			? $payload['start_lat'] . ',' . $payload['start_lng']
			: $payload['start_query'];
		$destination = null !== $payload['end_lat'] && null !== $payload['end_lng']
			? $payload['end_lat'] . ',' . $payload['end_lng']
			: $payload['end_query'];
		return add_query_arg(
			array(
				'api'         => '1',
				'origin'      => $origin,
				'destination' => $destination,
				'travelmode'  => 'driving',
			),
			'https://www.google.com/maps/dir/'
		);
	}
}
