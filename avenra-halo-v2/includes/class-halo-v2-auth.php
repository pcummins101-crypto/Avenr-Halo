<?php

defined( 'ABSPATH' ) || exit;

/**
 * Halo authentication is independent of WordPress user accounts. It uses an
 * opaque, revocable server-side session and a separate double-submit CSRF
 * token. Legacy handlers receive an isolated, request-only PHP session.
 */
final class Avenra_Halo_V2_Auth {
	public const SESSION_COOKIE = '__Host-avenra_halo_v2_session';
	public const CSRF_COOKIE    = '__Host-avenra_halo_v2_csrf';
	private const AUTH_REVISION = 2;
	private const DEPRECATED_SESSION_COOKIE = 'avenra_halo_v2_session';
	private const DEPRECATED_CSRF_COOKIE    = 'avenra_halo_v2_csrf';

	private static ?self $instance = null;
	private Avenra_Halo_V2_Database $db;
	private ?object $session = null;
	private ?object $customer = null;
	private bool $resolved = false;
	private string $request_session_token = '';

	private function __construct() {
		$this->db                    = Avenra_Halo_V2_Database::instance();
		$this->request_session_token = isset( $_COOKIE[ self::SESSION_COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::SESSION_COOKIE ] ) ) : '';
		$this->clear_deprecated_v2_cookies();
	}

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	public function permission_authenticated( WP_REST_Request $request ): bool|WP_Error {
		$same_origin = $this->permission_same_origin( $request );
		if ( true !== $same_origin ) {
			return $same_origin;
		}
		if ( ! $this->is_authenticated() ) {
			return Avenra_Halo_V2_Response::permission_error(
				'authentication_required',
				__( 'Please sign in to Halo again.', 'avenra-halo-v2' ),
				401
			);
		}

		$identity = $this->permission_expected_customer( $request, true );
		if ( is_wp_error( $identity ) ) {
			return $identity;
		}

		if ( ! in_array( strtoupper( $request->get_method() ), array( 'GET', 'HEAD', 'OPTIONS' ), true ) && ! $this->verify_csrf( $request ) ) {
			return Avenra_Halo_V2_Response::permission_error(
				'invalid_csrf',
				__( 'Your secure request token has expired. Refresh Halo and try again.', 'avenra-halo-v2' ),
				403
			);
		}

		return true;
	}

	/**
	 * Location writers use an unguessable per-link key rather than the Halo
	 * account cookie. When a cookie is present, still bind the request to the
	 * tab's expected customer so a stale tab cannot continue an earlier rider's
	 * browser session after another tab signs in to a different account.
	 */
	public function permission_live_tracking_update( WP_REST_Request $request ): bool|WP_Error {
		$same_origin = $this->permission_same_origin( $request );
		if ( true !== $same_origin || 'OPTIONS' === strtoupper( $request->get_method() ) ) {
			return $same_origin;
		}
		if ( ! $this->is_authenticated() ) {
			return true;
		}

		return $this->permission_expected_customer( $request, true );
	}

	/** Fail closed when a browser tab and the shared Halo cookie disagree. */
	private function permission_expected_customer( WP_REST_Request $request, bool $required ): bool|WP_Error {
		$expected = trim( (string) $request->get_header( 'X-Halo-Customer' ) );
		if ( '' === $expected ) {
			if ( ! $required ) {
				return true;
			}
			return Avenra_Halo_V2_Response::permission_error(
				'identity_context_required',
				__( 'Halo needs to refresh this tab before continuing.', 'avenra-halo-v2' ),
				409
			);
		}
		if ( ! preg_match( '/^\d+$/', $expected ) || ! hash_equals( (string) $this->customer_id(), $expected ) ) {
			return Avenra_Halo_V2_Response::permission_error(
				'identity_mismatch',
				__( 'Another Halo account is now active in this browser. This tab has been locked before making changes.', 'avenra-halo-v2' ),
				409
			);
		}

		return true;
	}

	/**
	 * Halo cookies authenticate a customer rather than a WordPress user, so
	 * authenticated browser requests must originate on the exact app origin.
	 * This also blocks credentialed CORS reads from sibling subdomains.
	 */
	public function permission_same_origin( WP_REST_Request $request ): bool|WP_Error {
		if ( 'OPTIONS' === strtoupper( $request->get_method() ) ) {
			return true;
		}

		$source     = trim( (string) ( $request->get_header( 'Origin' ) ?: $request->get_header( 'Referer' ) ) );
		$fetch_site = strtolower( trim( (string) $request->get_header( 'Sec-Fetch-Site' ) ) );
		if ( '' === $source ) {
			if ( in_array( $fetch_site, array( 'cross-site', 'same-site' ), true ) ) {
				return Avenra_Halo_V2_Response::permission_error( 'cross_origin_request_blocked', __( 'Halo blocked a request from another site.', 'avenra-halo-v2' ), 403 );
			}
			return (bool) apply_filters( 'avenra_halo_v2_allow_authenticated_request_without_origin', true, $request );
		}

		$expected = wp_parse_url( home_url( '/' ) );
		$actual   = wp_parse_url( $source );
		if ( ! is_array( $expected ) || ! is_array( $actual ) ) {
			return Avenra_Halo_V2_Response::permission_error( 'cross_origin_request_blocked', __( 'Halo blocked an invalid request origin.', 'avenra-halo-v2' ), 403 );
		}
		$expected_port = (int) ( $expected['port'] ?? ( 'https' === strtolower( (string) ( $expected['scheme'] ?? '' ) ) ? 443 : 80 ) );
		$actual_port   = (int) ( $actual['port'] ?? ( 'https' === strtolower( (string) ( $actual['scheme'] ?? '' ) ) ? 443 : 80 ) );
		$same_origin   = strtolower( (string) ( $expected['scheme'] ?? '' ) ) === strtolower( (string) ( $actual['scheme'] ?? '' ) )
			&& strtolower( (string) ( $expected['host'] ?? '' ) ) === strtolower( (string) ( $actual['host'] ?? '' ) )
			&& $expected_port === $actual_port;
		if ( ! $same_origin ) {
			return Avenra_Halo_V2_Response::permission_error( 'cross_origin_request_blocked', __( 'Halo blocked a request from another site.', 'avenra-halo-v2' ), 403 );
		}

		return true;
	}

	/**
	 * Public authentication mutations must still be same-origin browser calls.
	 * JSON is required so a cross-site HTML form cannot swap a victim into an
	 * attacker's account. Non-browser clients without Origin remain filterable.
	 */
	public function permission_public_auth( WP_REST_Request $request ): bool|WP_Error {
		if ( 'OPTIONS' === strtoupper( $request->get_method() ) ) {
			return true;
		}

		$content_type = strtolower( trim( (string) $request->get_header( 'Content-Type' ) ) );
		if ( ! str_starts_with( $content_type, 'application/json' ) ) {
			return Avenra_Halo_V2_Response::permission_error(
				'invalid_auth_request',
				__( 'Halo sign-in requests must come from the secure app.', 'avenra-halo-v2' ),
				403
			);
		}

		$source = trim( (string) ( $request->get_header( 'Origin' ) ?: $request->get_header( 'Referer' ) ) );
		$fetch_site = strtolower( trim( (string) $request->get_header( 'Sec-Fetch-Site' ) ) );
		if ( 'cross-site' === $fetch_site ) {
			return Avenra_Halo_V2_Response::permission_error(
				'cross_origin_auth_blocked',
				__( 'Halo blocked a cross-site authentication request.', 'avenra-halo-v2' ),
				403
			);
		}
		if ( '' !== $source ) {
			$expected = wp_parse_url( home_url( '/' ) );
			$actual   = wp_parse_url( $source );
			if ( ! is_array( $expected ) || ! is_array( $actual ) ) {
				return Avenra_Halo_V2_Response::permission_error( 'cross_origin_auth_blocked', __( 'Halo blocked an invalid authentication origin.', 'avenra-halo-v2' ), 403 );
			}
			$expected_port = (int) ( $expected['port'] ?? ( 'https' === strtolower( (string) ( $expected['scheme'] ?? '' ) ) ? 443 : 80 ) );
			$actual_port   = (int) ( $actual['port'] ?? ( 'https' === strtolower( (string) ( $actual['scheme'] ?? '' ) ) ? 443 : 80 ) );
			$same_origin   = strtolower( (string) ( $expected['scheme'] ?? '' ) ) === strtolower( (string) ( $actual['scheme'] ?? '' ) )
				&& strtolower( (string) ( $expected['host'] ?? '' ) ) === strtolower( (string) ( $actual['host'] ?? '' ) )
				&& $expected_port === $actual_port;
			if ( ! $same_origin ) {
				return Avenra_Halo_V2_Response::permission_error(
					'cross_origin_auth_blocked',
					__( 'Halo blocked a cross-site authentication request.', 'avenra-halo-v2' ),
					403
				);
			}
		}

		return (bool) apply_filters( 'avenra_halo_v2_allow_public_auth_request', true, $request, $source );
	}

	public function is_authenticated(): bool {
		$this->resolve();
		return null !== $this->session && null !== $this->customer;
	}

	public function customer_id(): int {
		return $this->is_authenticated() ? (int) $this->session->customer_id : 0;
	}

	public function customer(): ?object {
		$this->resolve();
		return $this->customer;
	}

	public function session(): ?object {
		$this->resolve();
		return $this->session;
	}

	/** Whether a stored row belongs to the authentication contract in this release. */
	public function session_record_has_current_auth_revision( ?object $session ): bool {
		if ( ! $session ) {
			return false;
		}
		$metadata = json_decode( (string) ( $session->metadata_json ?? '' ), true );
		return is_array( $metadata ) && self::AUTH_REVISION === (int) ( $metadata['auth_revision'] ?? 0 );
	}

	/** @return object|WP_Error|null Exact row carried by this request, including expired/revoked rows. */
	public function presented_session_record() {
		global $wpdb;

		if ( strlen( $this->request_session_token ) < 32 ) {
			return null;
		}
		$wpdb->last_error = '';
		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'sessions' ) ) . '` WHERE token_hash = %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				hash( 'sha256', $this->request_session_token )
			)
		);
		if ( '' !== (string) $wpdb->last_error ) {
			return new WP_Error( 'session_lookup_failed', __( 'Halo could not safely verify this device session.', 'avenra-halo-v2' ) );
		}
		return is_object( $row ) ? $row : null;
	}

	public function authenticate_pin( string $email, string $pin ): WP_REST_Response {
		global $wpdb;

		$email = strtolower( trim( sanitize_email( $email ) ) );
		$pin   = preg_replace( '/\D/', '', $pin );

		if ( ! is_email( $email ) || ! preg_match( '/^\d{6}$/', $pin ) ) {
			return Avenra_Halo_V2_Response::error( 'invalid_credentials', __( 'Enter a valid email address and six-digit PIN.', 'avenra-halo-v2' ), 422 );
		}

		if ( ! $this->db->source_tables_ready() ) {
			return Avenra_Halo_V2_Response::error( 'account_service_unavailable', __( 'Halo account access is temporarily unavailable.', 'avenra-halo-v2' ), 503 );
		}

		$account_limit    = (int) apply_filters( 'avenra_halo_v2_login_account_limit', 6 );
		$ip_limit         = (int) apply_filters( 'avenra_halo_v2_login_ip_limit', 30 );
		$account_allowed  = $this->db->consume_rate_limit( 'login-account', $email, $account_limit, 15 * MINUTE_IN_SECONDS );
		$ip_allowed       = $this->db->consume_rate_limit( 'login-ip', $this->client_ip(), $ip_limit, 15 * MINUTE_IN_SECONDS );
		if ( ! $account_allowed || ! $ip_allowed ) {
			return Avenra_Halo_V2_Response::error( 'login_throttled', __( 'Too many sign-in attempts. Please wait 15 minutes and try again.', 'avenra-halo-v2' ), 429, array( 'retry_after' => 900 ) );
		}

		$customer = $this->db->customer_by_email( $email );
		$valid    = $customer && $this->verify_customer_pin( $customer, $pin );

		if ( ! $valid ) {
			return Avenra_Halo_V2_Response::error( 'invalid_credentials', __( 'The email address or six-digit PIN was not recognised.', 'avenra-halo-v2' ), 401 );
		}
		$account_lock = $this->db->acquire_advisory_lock( 'auth-session', (string) (int) $customer->id, 2 );
		if ( ! $account_lock ) {
			return Avenra_Halo_V2_Response::error( 'sign_in_busy', __( 'Halo is securing this account. Please try signing in again.', 'avenra-halo-v2' ), 409, array( 'retryable' => true ) );
		}

		try {
			// Credentials may have changed while the first password hash was being
			// checked. Re-read and verify under the same lock used by PIN changes.
			$customer = $this->db->customer_by_id( (int) $customer->id );
			if ( ! $customer ) {
				return Avenra_Halo_V2_Response::error( 'account_service_unavailable', __( 'Halo could not safely verify this account. Please try again.', 'avenra-halo-v2' ), 503 );
			}
			if ( ! $this->verify_customer_pin( $customer, $pin ) ) {
				return Avenra_Halo_V2_Response::error( 'credentials_changed', __( 'Your Halo PIN changed while this sign-in was being checked. Enter the current PIN and try again.', 'avenra-halo-v2' ), 409 );
			}

		// A successful account clears only its own bucket. The origin bucket is
		// retained so cycling through addresses cannot erase brute-force history.
		$this->db->clear_rate_limit( 'login-account', $email );
		$this->migrate_legacy_pin_if_needed( $customer, $pin );

		$customers_table = $this->db->table( 'customers' );
		$reset_data      = $this->db->supported_data(
			$customers_table,
			array(
				'access_pin_failed_attempts' => 0,
				'access_pin_locked_until'    => null,
				'last_login_at'              => current_time( 'mysql', true ),
				'updated_at'                 => current_time( 'mysql', true ),
			)
		);
		if ( $reset_data ) {
			$wpdb->update( $customers_table, $reset_data, array( 'id' => (int) $customer->id ) );
		}

		$issued = $this->issue_session_locked( (int) $customer->id, $customer );
		if ( is_wp_error( $issued ) ) {
			if ( 'stale_browser_session' === $issued->get_error_code() ) {
				return Avenra_Halo_V2_Response::error( 'stale_browser_session', __( 'This browser has an older Halo session. Reset this device session, then sign in again.', 'avenra-halo-v2' ), 409, array( 'reset_required' => true ) );
			}
			if ( 'session_cookie_failed' === $issued->get_error_code() ) {
				return Avenra_Halo_V2_Response::error( 'session_cookie_failed', __( 'Your details were correct, but Halo could not save the secure session in this browser. Reset this device session and try again.', 'avenra-halo-v2' ), 503, array( 'reset_required' => true, 'retryable' => true ) );
			}
			return Avenra_Halo_V2_Response::error( 'session_service_unavailable', __( 'Your details were correct, but Halo could not start a secure session. Reset this device session and try again.', 'avenra-halo-v2' ), 503, array( 'reset_required' => true, 'retryable' => true ) );
		}
		return Avenra_Halo_V2_Response::success(
			array(
				'authenticated' => true,
				'customer'      => $this->public_customer( $customer ),
				'csrf'          => $issued['csrf'],
				'expires_at'    => $issued['expires_at'],
			),
			200
		);
		} finally {
			$this->db->release_advisory_lock( $account_lock );
		}
	}

	/** @return array{csrf:string,expires_at:string}|WP_Error */
	public function issue_session( int $customer_id, ?object $customer = null ): array|WP_Error {
		$account_lock = $this->db->acquire_advisory_lock( 'auth-session', (string) $customer_id, 2 );
		if ( ! $account_lock ) {
			return new WP_Error( 'session_issue_busy', __( 'Halo is securing this account. Please try again.', 'avenra-halo-v2' ) );
		}
		try {
			return $this->issue_session_locked( $customer_id, $customer );
		} finally {
			$this->db->release_advisory_lock( $account_lock );
		}
	}

	/** @return array{csrf:string,expires_at:string}|WP_Error */
	private function issue_session_locked( int $customer_id, ?object $customer = null ): array|WP_Error {
		global $wpdb;

		$retired = $this->retire_replaced_browser_session( $customer_id );
		if ( is_wp_error( $retired ) ) {
			return $retired;
		}

		$raw_token = self::random_token( 32 );
		$csrf      = self::random_token( 24 );
		$now       = time();
		$lifetime  = max( HOUR_IN_SECONDS, (int) apply_filters( 'avenra_halo_v2_session_lifetime', 30 * DAY_IN_SECONDS, $customer_id ) );
		$expires   = gmdate( 'Y-m-d H:i:s', $now + $lifetime );

		$inserted = $wpdb->insert(
			$this->db->table( 'sessions' ),
			array(
				'customer_id'     => $customer_id,
				'token_hash'      => hash( 'sha256', $raw_token ),
				'csrf_hash'       => hash( 'sha256', $csrf ),
				'ip_hash'         => $this->ip_hash(),
				'user_agent_hash' => $this->user_agent_hash(),
				'created_at'      => gmdate( 'Y-m-d H:i:s', $now ),
				'last_seen_at'    => gmdate( 'Y-m-d H:i:s', $now ),
				'expires_at'      => $expires,
				'metadata_json'   => wp_json_encode( array( 'version' => AVENRA_HALO_V2_VERSION, 'auth_revision' => self::AUTH_REVISION ) ),
			)
		);
		if ( ! $inserted || ! $wpdb->insert_id ) {
			do_action( 'avenra_halo_v2_session_error', $wpdb->last_error, $customer_id, Avenra_Halo_V2_Response::request_id() );
			return new WP_Error( 'session_insert_failed', __( 'A secure session could not be created.', 'avenra-halo-v2' ) );
		}
		$session_id = (int) $wpdb->insert_id;

		$session_row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'sessions' ) ) . '` WHERE id = %d', $session_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$resolved_customer = $customer ?: $this->db->customer_by_id( $customer_id );
		if ( ! $session_row || ! $resolved_customer || ! $this->session_record_has_current_auth_revision( $session_row ) ) {
			$wpdb->delete( $this->db->table( 'sessions' ), array( 'id' => $session_id ) );
			return new WP_Error( 'session_read_failed', __( 'A secure session could not be confirmed.', 'avenra-halo-v2' ) );
		}

		$session_cookie_set = $this->set_cookie( self::SESSION_COOKIE, $raw_token, $now + $lifetime, true, 'Lax' );
		$csrf_cookie_set    = $this->set_cookie( self::CSRF_COOKIE, $csrf, $now + $lifetime, false, 'Strict' );
		if ( ! $session_cookie_set || ! $csrf_cookie_set ) {
			$wpdb->delete( $this->db->table( 'sessions' ), array( 'id' => $session_id ) );
			if ( $session_cookie_set ) {
				$this->clear_cookie( self::SESSION_COOKIE, true, 'Lax' );
			}
			if ( $csrf_cookie_set ) {
				$this->clear_cookie( self::CSRF_COOKIE, false, 'Strict' );
			}
			do_action( 'avenra_halo_v2_session_error', 'secure_cookie_not_emitted', $customer_id, Avenra_Halo_V2_Response::request_id() );
			return new WP_Error( 'session_cookie_failed', __( 'The secure Halo cookies could not be emitted.', 'avenra-halo-v2' ) );
		}

		$this->session  = $session_row;
		$this->customer = $resolved_customer;
		$this->resolved = true;
		$this->request_session_token = $raw_token;
		// V2 identity must never persist in the browser V1 PHP session. The
		// compatibility bridge creates a separate cookie-less session only while a
		// proven legacy callback is running.
		$this->clear_legacy_session();

		return array(
			'csrf'       => $csrf,
			'expires_at' => mysql_to_rfc3339( $expires ),
		);
	}

	/**
	 * Cookies are shared by every tab on the hostname. Before replacing one,
	 * retire the exact previous session. If the identity is changing, serialize
	 * with live-link creation and end every public link for the prior customer so
	 * the last precise position cannot remain visible after an account switch.
	 */
	private function retire_replaced_browser_session( int $next_customer_id ): bool|WP_Error {
		global $wpdb;

		if ( strlen( $this->request_session_token ) < 32 ) {
			return true;
		}
		$previous_session = $this->presented_session_record();
		if ( is_wp_error( $previous_session ) ) {
			return $previous_session;
		}
		if ( ! $previous_session || ! empty( $previous_session->revoked_at ) || strtotime( (string) $previous_session->expires_at . ' UTC' ) <= time() ) {
			return new WP_Error( 'stale_browser_session', __( 'This request carries an older Halo browser session.', 'avenra-halo-v2' ) );
		}

		$previous_session_id  = (int) $previous_session->id;
		$previous_customer_id = (int) $previous_session->customer_id;
		$tracking_lock       = null;
		if ( $previous_customer_id !== $next_customer_id ) {
			$tracking_lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) $previous_customer_id, 2 );
			if ( ! $tracking_lock ) {
				return new WP_Error( 'account_switch_busy', __( 'Halo is still securing the previous account. Please try signing in again.', 'avenra-halo-v2' ) );
			}
		}

		try {
			if ( $previous_customer_id !== $next_customer_id ) {
				$ended = $wpdb->query(
					$wpdb->prepare(
						'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE customer_id = %d AND ended_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						current_time( 'mysql', true ),
						$previous_customer_id,
						current_time( 'mysql', true )
					)
				);
				if ( false === $ended ) {
					return new WP_Error( 'account_switch_privacy_failed', __( 'Halo could not safely end sharing for the previous account. Please try again.', 'avenra-halo-v2' ) );
				}
			}

			$revoked = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'sessions' ) ) . '` SET revoked_at = %s WHERE id = %d AND token_hash = %s AND revoked_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					$previous_session_id,
					(string) $previous_session->token_hash,
					current_time( 'mysql', true )
				)
			);
			// This is a compare-and-swap on the exact session captured from the
			// request cookie. A zero-row result means another tab already replaced
			// it; this stale response must never issue or overwrite a newer cookie.
			if ( false === $revoked ) {
				return new WP_Error( 'account_switch_session_failed', __( 'Halo could not retire the previous secure session. Please try again.', 'avenra-halo-v2' ) );
			}
			if ( 1 !== (int) $revoked ) {
				return new WP_Error( 'stale_browser_session', __( 'Another Halo request already replaced this browser session.', 'avenra-halo-v2' ) );
			}
		} finally {
			if ( $tracking_lock ) {
				$this->db->release_advisory_lock( $tracking_lock );
			}
		}

		// A previous explicit session issue or compatibility dispatch may have
		// mirrored this identity for V1 handlers. Remove it before issuing the
		// replacement so a revoked V2 identity cannot remain usable via PHPSESSID.
		$this->clear_legacy_session();
		$this->session  = null;
		$this->customer = null;
		$this->resolved = true;
		return true;
	}

	public function logout(): bool {
		global $wpdb;

		$this->resolve();
		if ( $this->session ) {
			$revoked = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'sessions' ) ) . '` SET revoked_at = %s WHERE id = %d AND revoked_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					current_time( 'mysql', true ),
					(int) $this->session->id
				)
			);
			// Do not clear a shared browser cookie when this request lost a race to
			// another tab that has already issued the replacement session.
			if ( 1 !== (int) $revoked ) {
				return false;
			}
		}

		$this->clear_cookie( self::SESSION_COOKIE, true, 'Lax' );
		$this->clear_cookie( self::CSRF_COOKIE, false, 'Strict' );
		$this->clear_legacy_session();
		$this->session  = null;
		$this->customer = null;
		$this->resolved = true;
		return true;
	}

	/** Explicit user action for recovering a revoked or otherwise stale device cookie. */
	public function clear_device_session(): void {
		$this->clear_cookie( self::SESSION_COOKIE, true, 'Lax' );
		$this->clear_cookie( self::CSRF_COOKIE, false, 'Strict' );
		$this->clear_legacy_session();
		$this->session               = null;
		$this->customer              = null;
		$this->resolved              = true;
		$this->request_session_token = '';
	}

	/** Revalidate the exact cached V2 session after acquiring an operation lock. */
	public function current_session_is_active(): bool {
		global $wpdb;

		$this->resolve();
		if ( ! $this->session || ! $this->customer ) {
			return false;
		}

		$active = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM `' . esc_sql( $this->db->table( 'sessions' ) ) . '` WHERE id = %d AND customer_id = %d AND token_hash = %s AND revoked_at IS NULL AND expires_at > %s', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				(int) $this->session->id,
				(int) $this->session->customer_id,
				(string) $this->session->token_hash,
				current_time( 'mysql', true )
			)
		);
		if ( 1 !== $active ) {
			$this->session  = null;
			$this->customer = null;
			return false;
		}

		return true;
	}

	/** Verify that the currently open V1 compatibility session belongs to V2. */
	public function legacy_session_binding_is_current(): bool {
		if ( PHP_SESSION_ACTIVE !== session_status() ) {
			return false;
		}
		$raw     = $this->request_session_token;
		$binding = isset( $_SESSION['avenra_halo_v2_binding'] ) ? (string) $_SESSION['avenra_halo_v2_binding'] : '';
		if ( strlen( $raw ) < 32 || '' === $binding ) {
			return false;
		}
		return hash_equals( hash_hmac( 'sha256', $raw, wp_salt( 'auth' ) ), $binding );
	}

	/**
	 * Return a freshly revalidated identity for an isolated V1 dispatch context.
	 * This method never starts or mutates a persistent PHP session.
	 *
	 * @return array{customer_id:int,customer_token:string,binding:string}|null
	 */
	public function legacy_dispatch_identity(): ?array {
		if ( ! $this->current_session_is_active() || ! $this->session || ! $this->customer ) {
			return null;
		}

		$source_token = (string) ( $this->customer->customer_token ?? $this->customer->access_token ?? $this->customer->token ?? '' );
		return array(
			'customer_id'    => (int) $this->session->customer_id,
			'customer_token' => '' !== $source_token ? $source_token : hash_hmac( 'sha256', $this->request_session_token, wp_salt( 'auth' ) ),
			'binding'        => hash_hmac( 'sha256', $this->request_session_token, wp_salt( 'auth' ) ),
		);
	}

	public function refresh_csrf_if_missing(): ?string {
		global $wpdb;

		if ( ! $this->is_authenticated() ) {
			return null;
		}

		$current = isset( $_COOKIE[ self::CSRF_COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::CSRF_COOKIE ] ) ) : '';
		if ( '' !== $current && hash_equals( (string) $this->session->csrf_hash, hash( 'sha256', $current ) ) ) {
			return $current;
		}

		$csrf = self::random_token( 24 );
		$updated = $wpdb->update( $this->db->table( 'sessions' ), array( 'csrf_hash' => hash( 'sha256', $csrf ) ), array( 'id' => (int) $this->session->id ) );
		if ( false === $updated ) {
			return null;
		}
		$this->session->csrf_hash = hash( 'sha256', $csrf );
		if ( ! $this->set_cookie( self::CSRF_COOKIE, $csrf, strtotime( (string) $this->session->expires_at . ' UTC' ), false, 'Strict' ) ) {
			do_action( 'avenra_halo_v2_session_error', 'csrf_cookie_not_emitted', (int) $this->session->customer_id, Avenra_Halo_V2_Response::request_id() );
			return null;
		}
		return $csrf;
	}

	public function verify_customer_pin( object $customer, string $pin ): bool {
		$hash = isset( $customer->access_pin_hash ) ? trim( (string) $customer->access_pin_hash ) : '';
		if ( '' !== $hash ) {
			// A migrated hash is authoritative. Never let a stale plaintext column
			// reopen an older PIN after the customer has changed credentials.
			return wp_check_password( $pin, $hash );
		}

		$legacy = isset( $customer->access_pin ) ? trim( (string) $customer->access_pin ) : '';
		return '' !== $legacy && hash_equals( $legacy, $pin );
	}

	/**
	 * Select the hashed PIN representation supported by the source schema.
	 * Legacy plaintext PINs remain login-only migration inputs; V2 will never
	 * create or change a credential unless access_pin_hash is available.
	 *
	 * @return array<string,mixed>
	 */
	public function pin_storage_data( string $table, string $pin ): array {
		if ( $this->db->has_column( $table, 'access_pin_hash' ) ) {
			$data = array(
				'access_pin_hash'        => wp_hash_password( $pin ),
				'access_pin_migrated_at' => current_time( 'mysql', true ),
			);
			if ( $this->db->has_column( $table, 'access_pin' ) ) {
				$data['access_pin'] = null;
			}
			return $this->db->supported_data( $table, $data );
		}

		return array();
	}

	/**
	 * Replace a customer PIN from the WordPress administrator support screen.
	 *
	 * The legacy plaintext value is never accepted as a fallback when a hash is
	 * present. An explicit, capability-checked administrator action is the only
	 * recovery path for an imported row whose two credential columns disagree.
	 */
	public function administrator_reset_customer_pin( int $customer_id, string $pin ): bool|WP_Error {
		global $wpdb;

		$capability = sanitize_key( (string) apply_filters( 'avenra_halo_v2_admin_capability', 'manage_options' ) );
		if ( '' === $capability || ! current_user_can( $capability ) ) {
			return new WP_Error( 'admin_pin_reset_forbidden', __( 'You are not allowed to reset Halo customer PINs.', 'avenra-halo-v2' ) );
		}
		if ( $customer_id < 1 || ! preg_match( '/^\d{6}$/', $pin ) ) {
			return new WP_Error( 'invalid_admin_pin_reset', __( 'Choose a six-digit Halo PIN.', 'avenra-halo-v2' ) );
		}
		if ( ! $this->db->source_tables_ready() ) {
			return new WP_Error( 'account_service_unavailable', __( 'Halo account access is temporarily unavailable.', 'avenra-halo-v2' ) );
		}

		$customers_table = $this->db->table( 'customers' );
		try {
			$pin_data = $this->pin_storage_data( $customers_table, $pin );
		} catch ( Throwable $error ) {
			error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				sprintf( '[Avenra Halo V2] admin_pin_hash_failed customer_id=%1$d request_id=%2$s exception=%3$s', $customer_id, Avenra_Halo_V2_Response::request_id(), get_class( $error ) )
			);
			return new WP_Error( 'pin_hash_failed', __( 'Halo could not securely hash the replacement PIN.', 'avenra-halo-v2' ) );
		}
		if ( ! $pin_data ) {
			return new WP_Error( 'pin_storage_unavailable', __( 'This account database cannot store a Halo PIN safely.', 'avenra-halo-v2' ) );
		}
		$generated_hash = isset( $pin_data['access_pin_hash'] ) ? trim( (string) $pin_data['access_pin_hash'] ) : '';
		$hash_probe     = (object) array( 'access_pin_hash' => $generated_hash, 'access_pin' => '' );
		try {
			$generated_hash_is_valid = '' !== $generated_hash && $this->verify_customer_pin( $hash_probe, $pin );
		} catch ( Throwable $error ) {
			$generated_hash_is_valid = false;
		}
		if ( ! $generated_hash_is_valid ) {
			return new WP_Error( 'pin_hash_verification_failed', __( 'Halo could not verify the replacement PIN hash.', 'avenra-halo-v2' ) );
		}

		$account_lock = $this->db->acquire_advisory_lock( 'auth-session', (string) $customer_id, 3 );
		if ( ! $account_lock ) {
			return new WP_Error( 'pin_reset_busy', __( 'Halo is securing this account. Please try again.', 'avenra-halo-v2' ) );
		}

		$tracking_lock    = null;
		$reset_succeeded  = false;
		$credential_updated = false;
		$rate_limit_email = '';
		try {
			$customer = $this->db->customer_by_id( $customer_id );
			if ( ! $customer ) {
				return new WP_Error( 'customer_not_found', __( 'No Halo customer matched that account.', 'avenra-halo-v2' ) );
			}

			$tracking_lock = $this->db->acquire_advisory_lock( 'live-tracking', (string) $customer_id, 3 );
			if ( ! $tracking_lock ) {
				return new WP_Error( 'pin_reset_busy', __( 'Halo is securing this account. Please try again.', 'avenra-halo-v2' ) );
			}

			$now  = current_time( 'mysql', true );
			$data = array_merge(
				$this->db->supported_data(
					$customers_table,
					array(
						'access_pin_failed_attempts' => 0,
						'access_pin_locked_until'    => null,
						'updated_at'                 => $now,
					)
				),
				$pin_data
			);
			$previous_credentials = $this->db->supported_data(
				$customers_table,
				array(
					'access_pin_hash'            => $customer->access_pin_hash ?? null,
					'access_pin'                 => $customer->access_pin ?? null,
					'access_pin_migrated_at'     => $customer->access_pin_migrated_at ?? null,
					'access_pin_failed_attempts' => $customer->access_pin_failed_attempts ?? 0,
					'access_pin_locked_until'    => $customer->access_pin_locked_until ?? null,
					'updated_at'                 => $customer->updated_at ?? $now,
				)
			);

			$revoked = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'sessions' ) ) . '` SET revoked_at = %s WHERE customer_id = %d AND revoked_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$now,
					$customer_id
				)
			);
			$ended = $wpdb->query(
				$wpdb->prepare(
					'UPDATE `' . esc_sql( $this->db->table( 'live_tracking' ) ) . '` SET ended_at = %s WHERE customer_id = %d AND ended_at IS NULL', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$now,
					$customer_id
				)
			);

			if ( false === $revoked || false === $ended ) {
				return new WP_Error( 'pin_reset_failed', __( 'Halo could not safely reset that customer PIN.', 'avenra-halo-v2' ) );
			}
			$updated = $wpdb->update( $customers_table, $data, array( 'id' => $customer_id ) );
			if ( false === $updated ) {
				return new WP_Error( 'pin_reset_failed', __( 'Halo ended earlier sessions but could not store the replacement PIN. Please try again.', 'avenra-halo-v2' ) );
			}
			$credential_updated = true;

			$verified_customer = $this->db->customer_by_id( $customer_id );
			$plaintext_pin      = $verified_customer && isset( $verified_customer->access_pin ) ? trim( (string) $verified_customer->access_pin ) : '';
			if ( ! $verified_customer || ! $this->verify_customer_pin( $verified_customer, $pin ) || '' !== $plaintext_pin ) {
				if ( ! $this->compensate_administrator_pin_reset( $customers_table, $customer_id, $generated_hash, $previous_credentials ) ) {
					error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
						sprintf( '[Avenra Halo V2] admin_pin_reset_compensation_failed customer_id=%1$d request_id=%2$s', $customer_id, Avenra_Halo_V2_Response::request_id() )
					);
				}
				$credential_updated = false;
				return new WP_Error( 'pin_reset_verification_failed', __( 'Halo could not verify the securely stored replacement PIN.', 'avenra-halo-v2' ) );
			}

			$rate_limit_email = strtolower( trim( sanitize_email( (string) ( $customer->email_address ?? '' ) ) ) );
			$reset_succeeded = true;
			return true;
		} catch ( Throwable $error ) {
			if ( $credential_updated && ! $reset_succeeded && ! $this->compensate_administrator_pin_reset( $customers_table, $customer_id, $generated_hash, $previous_credentials ?? array() ) ) {
				error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
					sprintf( '[Avenra Halo V2] admin_pin_reset_exception_compensation_failed customer_id=%1$d request_id=%2$s', $customer_id, Avenra_Halo_V2_Response::request_id() )
				);
			}
			error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				sprintf( '[Avenra Halo V2] admin_pin_reset_failed customer_id=%1$d request_id=%2$s exception=%3$s', $customer_id, Avenra_Halo_V2_Response::request_id(), get_class( $error ) )
			);
			return new WP_Error( 'pin_reset_failed', __( 'Halo could not safely reset that customer PIN.', 'avenra-halo-v2' ) );
		} finally {
			if ( $tracking_lock ) {
				$this->db->release_advisory_lock( $tracking_lock );
			}
			$this->db->release_advisory_lock( $account_lock );
			if ( $reset_succeeded ) {
				try {
					if ( '' !== $rate_limit_email ) {
						$this->db->clear_rate_limit( 'login-account', $rate_limit_email );
					}
					$this->db->clear_rate_limit( 'pin-change-account', (string) $customer_id );
				} catch ( Throwable $error ) {
					error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
						sprintf( '[Avenra Halo V2] admin_pin_reset_rate_limit_cleanup_failed customer_id=%1$d request_id=%2$s exception=%3$s', $customer_id, Avenra_Halo_V2_Response::request_id(), get_class( $error ) )
					);
				}

				$buffer_level = ob_get_level();
				$buffer_started = ob_start( static fn( string $output ): string => '' );
				try {
					if ( $buffer_started ) {
						do_action( 'avenra_halo_v2_admin_pin_reset', $customer_id, get_current_user_id(), Avenra_Halo_V2_Response::request_id() );
					}
				} catch ( Throwable $error ) {
					error_log( // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
						sprintf( '[Avenra Halo V2] admin_pin_reset_hook_failed customer_id=%1$d request_id=%2$s exception=%3$s', $customer_id, Avenra_Halo_V2_Response::request_id(), get_class( $error ) )
					);
				} finally {
					while ( ob_get_level() > $buffer_level ) {
						ob_end_clean();
					}
				}
			}
		}
	}

	/** Restore only when the row still contains the hash generated by this reset. */
	private function compensate_administrator_pin_reset( string $table, int $customer_id, string $generated_hash, array $previous_credentials ): bool {
		global $wpdb;

		if ( '' === $generated_hash || ! $previous_credentials ) {
			return false;
		}
		try {
			$restored = $wpdb->update(
				$table,
				$previous_credentials,
				array(
					'id'              => $customer_id,
					'access_pin_hash' => $generated_hash,
				)
			);
			return 1 === (int) $restored;
		} catch ( Throwable $error ) {
			return false;
		}
	}

	public function public_customer( object $customer ): array {
		$full_name = sanitize_text_field( (string) ( $customer->full_name ?? '' ) );
		$first     = '' !== $full_name ? explode( ' ', trim( $full_name ) )[0] : '';

		return array(
			'id'         => (int) $customer->id,
			'full_name'  => $full_name,
			'first_name' => $first,
			'email'      => sanitize_email( (string) ( $customer->email_address ?? '' ) ),
			'mobile'     => sanitize_text_field( (string) ( $customer->mobile_number ?? '' ) ),
			'postcode'   => sanitize_text_field( (string) ( $customer->postcode ?? '' ) ),
			'address'    => sanitize_textarea_field( (string) ( $customer->full_address ?? '' ) ),
		);
	}

	private function resolve(): void {
		global $wpdb;

		if ( $this->resolved ) {
			return;
		}
		$this->resolved = true;

		$raw = $this->request_session_token;
		if ( strlen( $raw ) < 32 ) {
			return;
		}

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM `' . esc_sql( $this->db->table( 'sessions' ) ) . '` WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > %s LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				hash( 'sha256', $raw ),
				current_time( 'mysql', true )
			)
		);

		if ( ! $row ) {
			// Never mutate a shared browser cookie from a passive response based on
			// an older request. A newer tab may already have replaced this token.
			return;
		}

		if ( ! $this->session_record_has_current_auth_revision( $row ) ) {
			// The revised authentication contract deliberately requires one fresh
			// sign-in so a session created by the earlier fail-open shell cannot
			// silently unlock the application.
			return;
		}

		$customer = $this->db->customer_by_id( (int) $row->customer_id );
		if ( ! $customer ) {
			// A missing source row and a transient customer-table failure are
			// indistinguishable here. Passive resolution must not revoke the only
			// session or strand live links; a later explicit operation can retry.
			return;
		}

		$this->session  = $row;
		$this->customer = $customer;
		if ( strtotime( (string) $row->last_seen_at . ' UTC' ) < time() - 300 ) {
			$wpdb->update( $this->db->table( 'sessions' ), array( 'last_seen_at' => current_time( 'mysql', true ) ), array( 'id' => (int) $row->id ) );
		}
	}

	private function verify_csrf( WP_REST_Request $request ): bool {
		$this->resolve();
		if ( ! $this->session ) {
			return false;
		}

		$header = trim( (string) $request->get_header( 'X-Halo-CSRF' ) );
		$cookie = isset( $_COOKIE[ self::CSRF_COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::CSRF_COOKIE ] ) ) : '';
		if ( '' === $header || '' === $cookie || ! hash_equals( $cookie, $header ) ) {
			return false;
		}

		return hash_equals( (string) $this->session->csrf_hash, hash( 'sha256', $header ) );
	}

	private function migrate_legacy_pin_if_needed( object $customer, string $pin ): void {
		global $wpdb;

		$hash   = isset( $customer->access_pin_hash ) ? trim( (string) $customer->access_pin_hash ) : '';
		$legacy = isset( $customer->access_pin ) ? trim( (string) $customer->access_pin ) : '';
		if ( '' !== $hash || '' === $legacy ) {
			return;
		}

		$table = $this->db->table( 'customers' );
		if ( ! $this->db->has_column( $table, 'access_pin_hash' ) ) {
			// Never erase the only usable credential on a pre-hash schema.
			return;
		}

		$data  = $this->db->supported_data(
			$table,
			array(
				'access_pin_hash'        => wp_hash_password( $pin ),
				'access_pin_migrated_at' => current_time( 'mysql', true ),
				'updated_at'             => current_time( 'mysql', true ),
			)
		);
		if ( $data ) {
			$updated = $wpdb->update( $table, $data, array( 'id' => (int) $customer->id ) );
			if ( false !== $updated && $this->db->has_column( $table, 'access_pin' ) ) {
				$wpdb->update( $table, array( 'access_pin' => null ), array( 'id' => (int) $customer->id ) );
			}
		}
	}

	private function clear_legacy_session(): void {
		// Never create a browser PHP session merely to clear compatibility state.
		// The legacy site may already have started one; if not, there is nothing to
		// scrub and the V2 __Host cookies remain the only browser identity.
		if ( PHP_SESSION_ACTIVE !== session_status() ) {
			return;
		}
		if ( ! isset( $_SESSION ) || ! is_array( $_SESSION ) ) {
			@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			return;
		}

		$legacy_keys         = array( 'avenra_customer_id', 'avenra_customer_token', 'avenra_halo_request_token', 'avenra_halo_v2_binding' );
		$had_legacy_identity = false;
		foreach ( $legacy_keys as $key ) {
			if ( array_key_exists( $key, $_SESSION ) ) {
				$had_legacy_identity = true;
				unset( $_SESSION[ $key ] );
			}
		}

		if ( $had_legacy_identity ) {
			@session_regenerate_id( true ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- release the browser session lock.
	}

	private function client_ip(): string {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
		return (string) apply_filters( 'avenra_halo_v2_client_ip', $ip );
	}

	private function ip_hash(): string {
		return hash_hmac( 'sha256', $this->client_ip(), wp_salt( 'auth' ) );
	}

	private function user_agent_hash(): string {
		$agent = isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '';
		return hash_hmac( 'sha256', $agent, wp_salt( 'auth' ) );
	}

	private function set_cookie( string $name, string $value, int $expires, bool $http_only, string $same_site ): bool {
		if ( headers_sent() ) {
			return false;
		}

		$emitted = setcookie(
			$name,
			$value,
			array(
				'expires'  => $expires,
				'path'     => '/',
				// The __Host- prefix requires Secure, Path=/ and no Domain. Browsers
				// then reject parent-domain cookie injection from sibling hosts.
				'secure'   => true,
				'httponly' => $http_only,
				'samesite' => $same_site,
			)
		);
		if ( ! $emitted ) {
			return false;
		}
		$_COOKIE[ $name ] = $value;
		return true;
	}

	private function clear_cookie( string $name, bool $http_only, string $same_site ): void {
		$this->set_cookie( $name, '', time() - YEAR_IN_SECONDS, $http_only, $same_site );
		unset( $_COOKIE[ $name ] );
	}

	/** Remove the pre-2.0 cookie names; they are never accepted for auth. */
	private function clear_deprecated_v2_cookies(): void {
		if ( headers_sent() ) {
			return;
		}

		$deprecated = array(
			self::DEPRECATED_SESSION_COOKIE => array( 'httponly' => true, 'samesite' => 'Lax' ),
			self::DEPRECATED_CSRF_COOKIE    => array( 'httponly' => false, 'samesite' => 'Strict' ),
		);
		foreach ( $deprecated as $name => $attributes ) {
			if ( ! isset( $_COOKIE[ $name ] ) ) {
				continue;
			}
			$options = array(
				'expires'  => time() - YEAR_IN_SECONDS,
				'path'     => '/',
				'secure'   => true,
				'httponly' => $attributes['httponly'],
				'samesite' => $attributes['samesite'],
			);
			setcookie( $name, '', $options );
			$legacy_domain = defined( 'COOKIE_DOMAIN' ) ? trim( (string) constant( 'COOKIE_DOMAIN' ) ) : '';
			if ( '' !== $legacy_domain ) {
				setcookie( $name, '', array_merge( $options, array( 'domain' => $legacy_domain ) ) );
			}
			unset( $_COOKIE[ $name ] );
		}
	}

	public static function random_token( int $bytes = 32 ): string {
		return rtrim( strtr( base64_encode( random_bytes( $bytes ) ), '+/', '-_' ), '=' );
	}
}
