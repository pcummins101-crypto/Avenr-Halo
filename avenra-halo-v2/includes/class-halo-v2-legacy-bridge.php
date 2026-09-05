<?php

defined( 'ABSPATH' ) || exit;

final class Avenra_Halo_V2_Legacy_Ajax_Exit extends RuntimeException {}

/**
 * Narrow compatibility bridge for proven V1 admin-ajax integrations. It is
 * intentionally allow-listed and can be replaced per action through filters.
 */
final class Avenra_Halo_V2_Legacy_Bridge {
	private static ?self $instance = null;

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}

		return self::$instance;
	}

	/**
	 * @param array<string,mixed> $payload
	 * @return array<string,mixed>|WP_Error
	 */
	public function dispatch( string $action, array $payload, int $customer_id ): array|WP_Error {
		$action  = sanitize_key( $action );
		$allowed = (array) apply_filters(
			'avenra_halo_v2_legacy_actions',
			array(
				'generate_safe_route_v22',
				'get_avenra_focus_zones',
				'get_avenra_rides',
				'reset_avenra_pin',
				'submit_boutique_order',
				'send_test_nok_alert',
				'send_nok_crash_alert_v2',
			)
		);

		if ( ! in_array( $action, array_map( 'sanitize_key', $allowed ), true ) ) {
			return new WP_Error( 'legacy_action_not_allowed', __( 'That compatibility action is not available.', 'avenra-halo-v2' ) );
		}

		/**
		 * A site integration can return an array here and bypass internal AJAX
		 * dispatch entirely. This is the preferred long-term migration path.
		 */
		$filtered = apply_filters( 'avenra_halo_v2_legacy_bridge_result', null, $action, $payload, $customer_id );
		if ( is_array( $filtered ) || is_wp_error( $filtered ) ) {
			return $filtered;
		}

		if ( ! apply_filters( 'avenra_halo_v2_enable_internal_legacy_dispatch', true, $action ) ) {
			return new WP_Error( 'legacy_action_disabled', __( 'The compatibility service is disabled.', 'avenra-halo-v2' ) );
		}

		$hooks = 0 === $customer_id
			? array( 'wp_ajax_nopriv_' . $action, 'wp_ajax_' . $action )
			: array( 'wp_ajax_' . $action, 'wp_ajax_nopriv_' . $action );
		$hook = '';
		foreach ( $hooks as $candidate ) {
			if ( has_action( $candidate ) ) {
				$hook = $candidate;
				break;
			}
		}
		if ( '' === $hook ) {
			return new WP_Error( 'legacy_action_missing', __( 'The existing service is not installed.', 'avenra-halo-v2' ) );
		}

		$auth          = Avenra_Halo_V2_Auth::instance();
		$db            = Avenra_Halo_V2_Database::instance();
		$account_lock  = null;
		$tracking_lock = null;
		$legacy_session = null;
		try {
			$identity = null;
			if ( $customer_id > 0 ) {
				// Keep the exact identity stable until the V1 callback returns. The
				// auth -> live order matches logout and PIN changes; a cross-account
				// replacement also needs the previous customer live lock.
				$account_lock = $db->acquire_advisory_lock( 'auth-session', (string) $customer_id, 2 );
				if ( ! $account_lock ) {
					return new WP_Error( 'legacy_session_busy', __( 'Halo is securing this account. Please try again.', 'avenra-halo-v2' ) );
				}
				$tracking_lock = $db->acquire_advisory_lock( 'live-tracking', (string) $customer_id, 2 );
				if ( ! $tracking_lock ) {
					return new WP_Error( 'legacy_session_busy', __( 'Halo is securing this account. Please try again.', 'avenra-halo-v2' ) );
				}
				$identity = $auth->legacy_dispatch_identity();
				if ( ! $identity || (int) $identity['customer_id'] !== $customer_id ) {
					return new WP_Error( 'legacy_session_unavailable', __( 'The existing service could not establish a secure compatibility session.', 'avenra-halo-v2' ) );
				}
			}

			// Never borrow the ambient browser V1 session. Authenticated and
			// anonymous callbacks both run in a random, cookie-less session that is
			// destroyed before this REST request continues.
			$legacy_session = $this->begin_isolated_legacy_session( $identity );
			if ( is_wp_error( $legacy_session ) ) {
				return $legacy_session;
			}
			$payload['security'] = (string) $legacy_session['request_token'];
			$payload['action'] = $action;

			$old_get     = $_GET;
			$old_post    = $_POST;
			$old_request = $_REQUEST;
			$old_status  = http_response_code();
			$old_status  = is_int( $old_status ) && $old_status >= 100 && $old_status <= 599 ? $old_status : 200;
			$_GET        = array_merge( $_GET, $payload );
			$_POST       = $payload;
			$_REQUEST    = array_merge( $_REQUEST, $payload );

			$die_factory = static function (): callable {
				return static function ( mixed $message = '' ) {
					if ( is_scalar( $message ) && '' !== (string) $message && '0' !== (string) $message ) {
						echo (string) $message; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- captured, never sent directly.
					}
					throw new Avenra_Halo_V2_Legacy_Ajax_Exit();
				};
			};
			$ajax_context = static function ( $doing ): bool {
				return true;
			};

			add_filter( 'wp_die_handler', $die_factory, PHP_INT_MAX );
			add_filter( 'wp_die_ajax_handler', $die_factory, PHP_INT_MAX );
			// wp_send_json() calls bare die() outside an Ajax request. Temporarily
			// emulate Ajax so it reaches the captured wp_die handler instead of
			// terminating the enclosing V2 REST response.
			add_filter( 'wp_doing_ajax', $ajax_context, PHP_INT_MAX );

			$buffer_level   = ob_get_level();
			$dispatch_error = null;
			$output         = '';
			ob_start();
			try {
				try {
					do_action( $hook );
				} catch ( Avenra_Halo_V2_Legacy_Ajax_Exit $exit ) {
					// Expected when a legacy callback uses wp_send_json().
				}
				$output = trim( (string) ob_get_clean() );
			} catch ( Throwable $error ) {
				$dispatch_error = $error;
			} finally {
				while ( ob_get_level() > $buffer_level ) {
					ob_end_clean();
				}
				$this->restore_request( $old_get, $old_post, $old_request, $die_factory, $ajax_context, $old_status );
			}
			if ( $dispatch_error instanceof Throwable ) {
				do_action( 'avenra_halo_v2_legacy_bridge_error', $action, $dispatch_error, $customer_id );
				return new WP_Error( 'legacy_action_failed', __( 'The existing service could not complete the request.', 'avenra-halo-v2' ) );
			}

			if ( '' === $output ) {
				return new WP_Error( 'legacy_empty_response', __( 'The existing service returned no data.', 'avenra-halo-v2' ) );
			}

			$decoded = json_decode( $output, true );
			if ( ! is_array( $decoded ) ) {
				return new WP_Error( 'legacy_invalid_response', __( 'The existing service returned an invalid response.', 'avenra-halo-v2' ) );
			}

			return $decoded;
		} finally {
			if ( is_array( $legacy_session ) ) {
				$this->end_isolated_legacy_session( $legacy_session );
			} elseif ( PHP_SESSION_ACTIVE === session_status() ) {
				@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			}
			if ( $tracking_lock ) {
				$db->release_advisory_lock( $tracking_lock );
			}
			if ( $account_lock ) {
				$db->release_advisory_lock( $account_lock );
			}
		}
	}

	/**
	 * Give an allow-listed V1 callback the session-shaped context it expects
	 * without creating or changing a browser PHPSESSID. The random server-side
	 * session is destroyed after this dispatch and cannot outlive the response.
	 *
	 * @param array{customer_id:int,customer_token:string,binding:string}|null $identity
	 * @return array<string,mixed>|WP_Error
	 */
	private function begin_isolated_legacy_session( ?array $identity ): array|WP_Error {
		$previous = array(
			'had_superglobal' => isset( $_SESSION ) && is_array( $_SESSION ),
			'superglobal'     => isset( $_SESSION ) && is_array( $_SESSION ) ? $_SESSION : null,
			'id'              => session_id(),
			'name'            => session_name(),
			'ini'             => array(
				'session.use_cookies'      => ini_get( 'session.use_cookies' ),
				'session.use_only_cookies' => ini_get( 'session.use_only_cookies' ),
				'session.use_strict_mode'  => ini_get( 'session.use_strict_mode' ),
				'session.use_trans_sid'     => ini_get( 'session.use_trans_sid' ),
				'session.cache_limiter'    => ini_get( 'session.cache_limiter' ),
			),
		);
		if ( PHP_SESSION_ACTIVE === session_status() ) {
			@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}

		try {
			$temporary_id = bin2hex( random_bytes( 24 ) );
		} catch ( Throwable $error ) {
			$temporary_id = wp_generate_password( 48, false, false );
		}
		@session_id( $temporary_id ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		$started = @session_start( // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			array(
				'use_cookies'      => false,
				'use_only_cookies' => false,
				'use_strict_mode'  => false,
				'use_trans_sid'     => false,
				'cache_limiter'    => '',
			)
		);
		if ( ! $started || PHP_SESSION_ACTIVE !== session_status() ) {
			$this->restore_session_runtime( $previous );
			return new WP_Error( 'legacy_session_unavailable', __( 'The existing service could not establish an isolated compatibility session.', 'avenra-halo-v2' ) );
		}

		$marker        = Avenra_Halo_V2_Auth::random_token( 24 );
		$request_token = Avenra_Halo_V2_Auth::random_token( 32 );
		$_SESSION      = array(
			'avenra_halo_request_token'      => $request_token,
			'avenra_halo_v2_isolated_dispatch' => $marker,
		);
		if ( is_array( $identity ) ) {
			$_SESSION['avenra_customer_id']    = (int) $identity['customer_id'];
			$_SESSION['avenra_customer_token'] = (string) $identity['customer_token'];
			$_SESSION['avenra_halo_v2_binding'] = (string) $identity['binding'];
		}

		return array(
			'previous'      => $previous,
			'temporary_id'  => $temporary_id,
			'marker'        => $marker,
			'request_token' => $request_token,
		);
	}

	/** @param array<string,mixed> $context */
	private function end_isolated_legacy_session( array $context ): void {
		$current_id  = session_id();
		$previous_id = (string) ( $context['previous']['id'] ?? '' );
		if ( PHP_SESSION_ACTIVE !== session_status() && '' !== $current_id && $current_id !== $previous_id ) {
			@session_start( array( 'use_cookies' => false, 'use_only_cookies' => false, 'use_strict_mode' => false, 'use_trans_sid' => false, 'cache_limiter' => '' ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		if ( PHP_SESSION_ACTIVE === session_status() ) {
			$_SESSION = array();
			@session_destroy(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		$this->restore_session_runtime( (array) ( $context['previous'] ?? array() ) );
	}

	/** @param array<string,mixed> $previous */
	private function restore_session_runtime( array $previous ): void {
		if ( PHP_SESSION_ACTIVE === session_status() ) {
			@session_write_close(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		foreach ( (array) ( $previous['ini'] ?? array() ) as $setting => $value ) {
			if ( false !== $value ) {
				@ini_set( (string) $setting, (string) $value ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			}
		}
		@session_name( (string) ( $previous['name'] ?? session_name() ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		@session_id( (string) ( $previous['id'] ?? '' ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		if ( ! empty( $previous['had_superglobal'] ) && is_array( $previous['superglobal'] ?? null ) ) {
			$_SESSION = $previous['superglobal'];
		} else {
			unset( $_SESSION );
		}
	}

	/** @param array<string,mixed> $get @param array<string,mixed> $post @param array<string,mixed> $request */
	private function restore_request( array $get, array $post, array $request, callable $die_factory, callable $ajax_context, int $status ): void {
		$_GET     = $get;
		$_POST    = $post;
		$_REQUEST = $request;
		remove_filter( 'wp_die_handler', $die_factory, PHP_INT_MAX );
		remove_filter( 'wp_die_ajax_handler', $die_factory, PHP_INT_MAX );
		remove_filter( 'wp_doing_ajax', $ajax_context, PHP_INT_MAX );
		http_response_code( $status );
	}
}
