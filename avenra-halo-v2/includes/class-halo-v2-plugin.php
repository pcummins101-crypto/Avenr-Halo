<?php

defined( 'ABSPATH' ) || exit;

final class Avenra_Halo_V2_Plugin {
	private const UPGRADE_RETRY_TRANSIENT = 'avenra_halo_v2_upgrade_retry_version';
	private const UPGRADE_RETRY_SECONDS   = 300;

	private static ?self $instance = null;
	private bool $booted = false;

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
		add_action( 'template_redirect', array( $this, 'serve_pwa_endpoint' ), 0 );
		add_action( 'template_redirect', array( $this, 'consume_shop_handoff' ), 0 );
		add_action( 'template_redirect', array( $this, 'protect_app_page' ), 1 );
		add_filter( 'template_include', array( $this, 'app_page_template' ), 99 );
		add_action( 'rest_api_init', array( Avenra_Halo_V2_REST::instance(), 'register_routes' ) );
		add_filter( 'rest_post_dispatch', array( Avenra_Halo_V2_REST::instance(), 'normalise_response' ), 10, 3 );
		add_filter( 'rest_pre_serve_request', array( Avenra_Halo_V2_REST::instance(), 'serve_private_document' ), 10, 4 );
		add_shortcode( 'avenra_halo_v2', array( $this, 'shortcode' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'wp_head', array( $this, 'manifest_link' ), 2 );
		add_filter( 'script_loader_tag', array( $this, 'defer_scripts' ), 10, 3 );
		add_filter( 'rocket_cache_reject_uri', array( $this, 'exclude_app_from_rocket_cache' ) );
		add_filter( 'rocket_delay_js_exclusions', array( $this, 'exclude_app_scripts_from_rocket' ) );
		add_filter( 'rocket_exclude_defer_js', array( $this, 'exclude_app_scripts_from_rocket' ) );
		add_filter( 'rocket_exclude_js', array( $this, 'exclude_app_scripts_from_rocket' ) );
		add_filter( 'do_rocket_generate_caching_files', array( $this, 'disable_rocket_cache_generation' ) );
		add_action( 'avenra_halo_v2_cleanup', array( Avenra_Halo_V2_Database::instance(), 'cleanup' ) );
		add_action( 'init', array( $this, 'ensure_cleanup_schedule' ) );
		add_action( 'plugins_loaded', array( $this, 'maybe_upgrade' ), 20 );
		Avenra_Halo_V2_Guardian::instance()->boot();
		Avenra_Halo_V2_Emergency::instance()->boot();
		Avenra_Halo_V2_Native_Ride::instance()->boot();
		Avenra_Halo_V2_Presence::instance()->boot();
		Avenra_Halo_V2_Risk::instance()->boot();
		Avenra_Halo_V2_Operations::instance()->boot();
		Avenra_Halo_V2_Incident_Media::instance()->boot();
		Avenra_Halo_V2_Community::instance()->boot();
		Avenra_Halo_V2_Admin::instance()->boot();
	}

	public static function activate(): void {
		// A manual activation is an explicit request to retry any incomplete upgrade.
		delete_transient( self::UPGRADE_RETRY_TRANSIENT );
		self::invalidate_plugin_opcode_cache();
		Avenra_Halo_V2_Database::install();
		Avenra_Halo_V2_Incident_Media::install();
		self::create_app_page();
		self::instance()->register_rewrites();
		Avenra_Halo_V2_Emergency::instance()->register_rewrites();
		Avenra_Halo_V2_Operations::install_capabilities();
		Avenra_Halo_V2_Community::install_moderation_capability();
		Avenra_Halo_V2_Operations::instance()->register_rewrites();
		flush_rewrite_rules();
		self::purge_app_page_cache();

		self::instance()->ensure_cleanup_schedule();
	}

	public static function deactivate(): void {
		wp_clear_scheduled_hook( 'avenra_halo_v2_cleanup' );
		wp_clear_scheduled_hook( 'avenra_halo_v2_emergency_escalate' );
		wp_clear_scheduled_hook( 'avenra_halo_v2_emergency_enrich' );
		wp_clear_scheduled_hook( 'avenra_halo_v2_emergency_activate_candidate' );
		wp_clear_scheduled_hook( 'avenra_halo_v2_guardian_sms_fallback' );
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			as_unschedule_all_actions( 'avenra_halo_v2_guardian_sms_fallback', array(), 'avenra-halo-v2' );
			as_unschedule_all_actions( 'avenra_halo_v2_emergency_escalate', array(), 'avenra-halo-v2' );
			as_unschedule_all_actions( 'avenra_halo_v2_emergency_enrich', array(), 'avenra-halo-v2' );
			as_unschedule_all_actions( 'avenra_halo_v2_emergency_activate_candidate', array(), 'avenra-halo-v2' );
		}
		flush_rewrite_rules();
	}

	public function maybe_upgrade(): void {
		$installed_version = (string) get_option( 'avenra_halo_v2_db_version', '' );
		if ( AVENRA_HALO_V2_VERSION === $installed_version ) {
			delete_transient( self::UPGRADE_RETRY_TRANSIENT );
			return;
		}

		// Database::install() deliberately leaves the version unchanged when its
		// schema verification fails. Cool down retries so a partial migration
		// cannot run dbDelta and flush rewrite rules on every frontend request.
		if ( AVENRA_HALO_V2_VERSION === (string) get_transient( self::UPGRADE_RETRY_TRANSIENT ) ) {
			return;
		}
		set_transient( self::UPGRADE_RETRY_TRANSIENT, AVENRA_HALO_V2_VERSION, self::UPGRADE_RETRY_SECONDS );

		self::invalidate_plugin_opcode_cache();
		Avenra_Halo_V2_Database::install();
		Avenra_Halo_V2_Incident_Media::install();
		$this->register_rewrites();
		Avenra_Halo_V2_Emergency::instance()->register_rewrites();
		Avenra_Halo_V2_Operations::install_capabilities();
		Avenra_Halo_V2_Community::install_moderation_capability();
		Avenra_Halo_V2_Operations::instance()->register_rewrites();
		flush_rewrite_rules();
		self::purge_app_page_cache();

		if ( AVENRA_HALO_V2_VERSION === (string) get_option( 'avenra_halo_v2_db_version', '' ) ) {
			delete_transient( self::UPGRADE_RETRY_TRANSIENT );
		}
	}

	/** Restore the retention job if a cron reset or migration removed it. */
	public function ensure_cleanup_schedule(): void {
		if ( ! wp_next_scheduled( 'avenra_halo_v2_cleanup' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'avenra_halo_v2_cleanup' );
		}
	}

	private static function create_app_page(): void {
		$page_id = (int) get_option( 'avenra_halo_v2_page_id' );
		if ( $page_id && get_post( $page_id ) && '1' === get_post_meta( $page_id, '_avenra_halo_v2_page', true ) ) {
			if ( 'trash' === get_post_status( $page_id ) ) {
				wp_untrash_post( $page_id );
			}
			if ( 'publish' !== get_post_status( $page_id ) ) {
				wp_update_post( array( 'ID' => $page_id, 'post_status' => 'publish' ) );
			}
			return;
		}

		$owned = get_posts(
			array(
				'post_type'      => 'page',
				'post_status'    => array( 'publish', 'draft', 'private', 'trash' ),
				'meta_key'       => '_avenra_halo_v2_page',
				'meta_value'     => '1',
				'posts_per_page' => 1,
			)
		);
		if ( $owned ) {
			$page_id = (int) $owned[0]->ID;
			if ( 'trash' === get_post_status( $page_id ) ) {
				wp_untrash_post( $page_id );
			}
			if ( 'publish' !== get_post_status( $page_id ) ) {
				wp_update_post( array( 'ID' => $page_id, 'post_status' => 'publish' ) );
			}
			update_option( 'avenra_halo_v2_page_id', $page_id, false );
			return;
		}

		// Never overwrite an unrelated page that already owns /halo-v2/.
		$slug = get_page_by_path( 'halo-v2' ) ? 'avenra-halo-v2' : 'halo-v2';
		$id   = wp_insert_post(
			array(
				'post_title'   => 'Avenrà Halo V2',
				'post_name'    => $slug,
				'post_content' => '[avenra_halo_v2]',
				'post_status'  => 'publish',
				'post_type'    => 'page',
				'comment_status' => 'closed',
			),
			true
		);
		if ( ! is_wp_error( $id ) ) {
			update_post_meta( (int) $id, '_avenra_halo_v2_page', '1' );
			update_option( 'avenra_halo_v2_page_id', (int) $id, false );
		}
	}

	public function register_rewrites(): void {
		add_rewrite_rule( '^halo-v2-sw\.js$', 'index.php?avenra_halo_v2_sw=1', 'top' );
		add_rewrite_rule( '^halo-v2-manifest\.webmanifest$', 'index.php?avenra_halo_v2_manifest=1', 'top' );
	}

	/** @param string[] $vars @return string[] */
	public function query_vars( array $vars ): array {
		$vars[] = 'avenra_halo_v2_sw';
		$vars[] = 'avenra_halo_v2_manifest';
		return $vars;
	}

	public function serve_pwa_endpoint(): void {
		if ( (int) get_query_var( 'avenra_halo_v2_sw' ) === 1 ) {
			$this->serve_service_worker();
		}

		if ( (int) get_query_var( 'avenra_halo_v2_manifest' ) === 1 ) {
			$this->serve_manifest();
		}
	}

	public function protect_app_page(): void {
		if ( ! $this->is_app_page() ) {
			return;
		}

		// Halo is an authenticated application shell, not a cacheable marketing
		// page. A stale shell can pair old JavaScript with a newer REST API and
		// allow native form navigation before the app has bound its handlers.
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
		$tracking_token = isset( $_GET['track'] ) && is_string( $_GET['track'] ) ? sanitize_text_field( wp_unslash( $_GET['track'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only bearer-link detection.
		$is_tracking    = 1 === preg_match( '/^[A-Za-z0-9_-]{40,90}$/', $tracking_token );
		header( 'Referrer-Policy: ' . ( $is_tracking ? 'no-referrer' : 'strict-origin-when-cross-origin' ), true );
		if ( $is_tracking ) {
			header( 'X-Robots-Tag: noindex, nofollow, noarchive, nosnippet', true );
		}
		header( "Permissions-Policy: geolocation=(self), camera=(self), accelerometer=(self), gyroscope=(self), bluetooth=(self)", true );
		header( 'X-Frame-Options: SAMEORIGIN', true );
		// Multiple CSP headers are combined restrictively by browsers, so this
		// safely adds clickjacking protection without replacing the site policy.
		header( "Content-Security-Policy: frame-ancestors 'self'", false );
	}

	public function shortcode( array $attributes = array() ): string {
		$template = AVENRA_HALO_V2_DIR . 'templates/app-shell.php';
		if ( ! file_exists( $template ) ) {
			return '<div id="avenra-halo-v2" class="avenra-halo-v2" data-version="' . esc_attr( AVENRA_HALO_V2_VERSION ) . '"></div>';
		}

		$halo_v2_config = $this->client_config();
		ob_start();
		include $template;
		return (string) ob_get_clean();
	}

	public function enqueue_assets(): void {
		if ( ! $this->is_app_page() ) {
			return;
		}

		wp_enqueue_style( 'avenra-halo-v2', AVENRA_HALO_V2_URL . 'assets/css/halo-v2.css', array(), AVENRA_HALO_V2_VERSION );

		wp_enqueue_script( 'avenra-halo-v2-map', AVENRA_HALO_V2_URL . 'assets/js/halo-map.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-ride', AVENRA_HALO_V2_URL . 'assets/js/ride-engine.js', array( 'avenra-halo-v2-map' ), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-ride-focus', AVENRA_HALO_V2_URL . 'assets/js/ride-focus.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-webtonative-sdk', AVENRA_HALO_V2_URL . 'assets/vendor/webtonative/webtonative-1.0.63.min.js', array(), '1.0.63', true );
		wp_enqueue_script( 'avenra-halo-v2-webtonative-ride', AVENRA_HALO_V2_URL . 'assets/js/webtonative-ride.js', array( 'avenra-halo-v2-webtonative-sdk' ), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-bms-bluetooth', AVENRA_HALO_V2_URL . 'assets/js/bms-bluetooth.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-hypercore-ecu', AVENRA_HALO_V2_URL . 'assets/js/hypercore-ecu.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-vehicle-specification', AVENRA_HALO_V2_URL . 'assets/js/vehicle-specification.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-camera-alignment', AVENRA_HALO_V2_URL . 'assets/js/camera-alignment.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-incident-camera', AVENRA_HALO_V2_URL . 'assets/js/incident-camera.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-ride-memories', AVENRA_HALO_V2_URL . 'assets/js/ride-memories.js', array(), AVENRA_HALO_V2_VERSION, true );
		wp_enqueue_script( 'avenra-halo-v2-app', AVENRA_HALO_V2_URL . 'assets/js/app.js', array( 'avenra-halo-v2-map', 'avenra-halo-v2-ride', 'avenra-halo-v2-ride-focus', 'avenra-halo-v2-webtonative-ride', 'avenra-halo-v2-bms-bluetooth', 'avenra-halo-v2-hypercore-ecu', 'avenra-halo-v2-vehicle-specification', 'avenra-halo-v2-camera-alignment', 'avenra-halo-v2-incident-camera', 'avenra-halo-v2-ride-memories' ), AVENRA_HALO_V2_VERSION, true );

		$config = $this->client_config();
		wp_localize_script( 'avenra-halo-v2-app', 'AvenraHaloV2Config', $config );
		wp_localize_script( 'avenra-halo-v2-app', 'AvenraHaloV2', $config );
	}

	/** @return array<string,mixed> */
	private function client_config(): array {
		$page_url = self::page_url();
		$tile_url = $this->sanitise_tile_url( (string) apply_filters( 'avenra_halo_v2_tile_url', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' ) );
		$links    = (array) apply_filters(
			'avenra_halo_v2_public_links',
			array(
				'support'        => 'mailto:' . sanitize_email( (string) apply_filters( 'avenra_halo_v2_support_email', 'info@rideavenra.com' ) ),
				'book_service'   => add_query_arg( 'type', 'mobile', home_url( '/service/' ) ),
				'dealer_locator' => add_query_arg( 'type', 'dealer', home_url( '/service/' ) ),
				'test_ride'      => 'https://rideavenra.com/Test-Ride',
				'configurator'   => home_url( '/configurator/' ),
			)
		);

		return array(
			'version'       => AVENRA_HALO_V2_VERSION,
			'restBase'      => trailingslashit( esc_url_raw( rest_url( 'avenra-halo/v2' ) ) ),
			'pageUrl'       => esc_url_raw( $page_url ),
			// Do not pass URL templates through esc_url_raw(): it can remove the
			// Leaflet {z}/{x}/{y} placeholders and leave the map permanently blank.
			'tileUrl'       => $tile_url,
			'manifestUrl'   => esc_url_raw( home_url( '/halo-v2-manifest.webmanifest?v=' . rawurlencode( AVENRA_HALO_V2_VERSION ) ) ),
			'swUrl'         => esc_url_raw( home_url( '/halo-v2-sw.js?v=' . rawurlencode( AVENRA_HALO_V2_VERSION ) ) ),
			'swScope'       => esc_url_raw( wp_parse_url( $page_url, PHP_URL_PATH ) ?: '/halo-v2/' ),
			'serviceWorkerUrl'   => esc_url_raw( home_url( '/halo-v2-sw.js?v=' . rawurlencode( AVENRA_HALO_V2_VERSION ) ) ),
			'serviceWorkerScope' => esc_url_raw( wp_parse_url( $page_url, PHP_URL_PATH ) ?: '/halo-v2/' ),
			'csrfCookie'    => Avenra_Halo_V2_Auth::CSRF_COOKIE,
			'csrfHeader'    => 'X-Halo-CSRF',
			// Halo authenticates customer sessions independently of WordPress users.
			// Sending an expired admin nonce can make core reject an otherwise valid
			// Halo login before the plugin permission callback runs.
			'wpRestNonce'   => '',
			'restNonce'     => '',
			'passkeysEnabled' => false,
			'passkeyEndpoints' => array(),
			'manualSections'   => array(),
			'maxDocumentSizeMb' => max( 1, (int) floor( (int) apply_filters( 'avenra_halo_v2_document_max_bytes', 10 * MB_IN_BYTES ) / MB_IN_BYTES ) ),
			'maxVehiclePhotoMb' => max( 1, (int) floor( (int) apply_filters( 'avenra_halo_v2_vehicle_photo_max_bytes', 8 * MB_IN_BYTES ) / MB_IN_BYTES ) ),
			'brandLogoWhite' => esc_url_raw( (string) apply_filters( 'avenra_halo_v2_logo_white', AVENRA_HALO_V2_LOGO_WHITE ) ),
			'brandLogoBlack' => esc_url_raw( (string) apply_filters( 'avenra_halo_v2_logo_black', AVENRA_HALO_V2_LOGO_BLACK ) ),
			'profileMarks'   => array(
				'default' => esc_url_raw( (string) apply_filters( 'avenra_halo_v2_profile_mark_default', AVENRA_HALO_V2_PROFILE_MARK_DEFAULT ) ),
				'evo'     => esc_url_raw( (string) apply_filters( 'avenra_halo_v2_profile_mark_evo', AVENRA_HALO_V2_PROFILE_MARK_EVO ) ),
				'one'     => esc_url_raw( (string) apply_filters( 'avenra_halo_v2_profile_mark_one', AVENRA_HALO_V2_PROFILE_MARK_ONE ) ),
			),
			'canonicalRangeImage' => esc_url_raw( (string) apply_filters( 'avenra_halo_v2_range_image', AVENRA_HALO_V2_RANGE_IMAGE ) ),
			'links'          => $links,
			'locale'        => determine_locale(),
			'units'         => 'imperial',
			'mapAttribution'=> '© OpenStreetMap contributors',
		);
	}

	/**
	 * Validate a map-tile URL without destroying its template placeholders.
	 * Only same-format HTTP(S) templates containing z/x/y are accepted.
	 */
	private function sanitise_tile_url( string $candidate ): string {
		$fallback = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
		$candidate = trim( $candidate );
		if ( '' === $candidate || preg_match( '/[\x00-\x20<>"\'\\\\]/', $candidate ) ) {
			return $fallback;
		}
		foreach ( array( '{z}', '{x}', '{y}' ) as $required ) {
			if ( ! str_contains( $candidate, $required ) ) {
				return $fallback;
			}
		}

		$tokens = array(
			'{s}' => 'tile-subdomain',
			'{z}' => '12',
			'{x}' => '2048',
			'{y}' => '2048',
			'{r}' => '',
		);
		$probe  = strtr( $candidate, $tokens );
		$parts  = wp_parse_url( $probe );
		if ( ! is_array( $parts ) || 'https' !== strtolower( (string) ( $parts['scheme'] ?? '' ) ) || empty( $parts['host'] ) ) {
			return $fallback;
		}

		return $candidate;
	}

	public function manifest_link(): void {
		if ( $this->is_app_page() ) {
			echo '<link rel="manifest" href="' . esc_url( home_url( '/halo-v2-manifest.webmanifest?v=' . rawurlencode( AVENRA_HALO_V2_VERSION ) ) ) . '">' . "\n";
			echo '<link rel="apple-touch-icon" href="' . esc_url( AVENRA_HALO_V2_URL . 'assets/images/halo-apple-touch.png' ) . '">' . "\n";
			echo '<meta name="theme-color" content="#f5f5f2">' . "\n";
			echo '<meta name="mobile-web-app-capable" content="yes">' . "\n";
			echo '<meta name="apple-mobile-web-app-capable" content="yes">' . "\n";
			echo '<meta name="apple-mobile-web-app-status-bar-style" content="default">' . "\n";
			echo '<meta name="apple-mobile-web-app-title" content="Halo">' . "\n";
		}
	}

	public function defer_scripts( string $tag, string $handle, string $src ): string {
		if ( in_array( $handle, array( 'avenra-halo-v2-map', 'avenra-halo-v2-ride', 'avenra-halo-v2-ride-focus', 'avenra-halo-v2-webtonative-sdk', 'avenra-halo-v2-webtonative-ride', 'avenra-halo-v2-bms-bluetooth', 'avenra-halo-v2-hypercore-ecu', 'avenra-halo-v2-vehicle-specification', 'avenra-halo-v2-camera-alignment', 'avenra-halo-v2-incident-camera', 'avenra-halo-v2-ride-memories', 'avenra-halo-v2-app' ), true ) && ! str_contains( $tag, ' defer' ) ) {
			return str_replace( ' src=', ' defer src=', $tag );
		}
		return $tag;
	}

	/** @param string[] $uris @return string[] */
	public function exclude_app_from_rocket_cache( array $uris ): array {
		$path = trim( (string) wp_parse_url( self::page_url(), PHP_URL_PATH ), '/' );
		if ( '' !== $path ) {
			$uris[] = '/' . $path . '/(.*)';
		}
		$uris[] = '/halo-v2-sw.js(.*)';
		$uris[] = '/halo-v2-manifest.webmanifest(.*)';
		$uris[] = '/halo-assist/(.*)';
		$uris[] = '/halo-emergency-assist/(.*)';
		$uris[] = '/wp-json/avenra-halo/v2/(.*)';
		return array_values( array_unique( $uris ) );
	}

	/** @param string[] $exclusions @return string[] */
	public function exclude_app_scripts_from_rocket( array $exclusions ): array {
		if ( ! $this->is_app_page() ) {
			return $exclusions;
		}
		$exclusions[] = '/avenra-halo-v2/assets/js/';
		$exclusions[] = 'AvenraHaloV2Config';
		$exclusions[] = 'AvenraHaloV2';
		return array_values( array_unique( $exclusions ) );
	}

	public function disable_rocket_cache_generation( bool $generate ): bool {
		return $this->is_app_page() ? false : $generate;
	}

	private function is_app_page(): bool {
		if ( $this->is_owned_app_page() ) {
			return true;
		}

		global $post;
		return is_singular() && $post instanceof WP_Post && has_shortcode( (string) $post->post_content, 'avenra_halo_v2' );
	}

	private function is_owned_app_page(): bool {
		$page_id = (int) get_option( 'avenra_halo_v2_page_id' );
		return $page_id && is_page( $page_id ) && '1' === get_post_meta( $page_id, '_avenra_halo_v2_page', true );
	}

	private static function purge_app_page_cache(): void {
		$page_id = (int) get_option( 'avenra_halo_v2_page_id' );
		if ( $page_id > 0 ) {
			clean_post_cache( $page_id );
			if ( function_exists( 'rocket_clean_post' ) ) {
				rocket_clean_post( $page_id );
			}
		}
		do_action( 'avenra_halo_v2_purge_app_cache', $page_id, self::page_url() );
	}

	/** Invalidate only Halo PHP files when the host exposes OPcache controls. */
	private static function invalidate_plugin_opcode_cache(): void {
		if ( ! function_exists( 'opcache_invalidate' ) ) {
			return;
		}
		$files = array_merge(
			(array) glob( AVENRA_HALO_V2_DIR . '*.php' ),
			(array) glob( AVENRA_HALO_V2_DIR . 'includes/*.php' ),
			(array) glob( AVENRA_HALO_V2_DIR . 'templates/*.php' )
		);
		foreach ( array_unique( $files ) as $file ) {
			if ( is_file( $file ) ) {
				@opcache_invalidate( $file, true ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			}
		}
	}

	public function app_page_template( string $template ): string {
		$plugin_template = AVENRA_HALO_V2_DIR . 'templates/page-halo-v2.php';
		return $this->is_owned_app_page() && file_exists( $plugin_template ) ? $plugin_template : $template;
	}

	public function consume_shop_handoff(): void {
		if ( empty( $_GET['avenra_halo_handoff'] ) ) {
			return;
		}

		$token = sanitize_text_field( wp_unslash( $_GET['avenra_halo_handoff'] ) );
		if ( ! preg_match( '/^[A-Za-z0-9_-]{30,90}$/', $token ) || ! function_exists( 'wc_get_checkout_url' ) ) {
			wp_safe_redirect( add_query_arg( 'shop_error', 'handoff_unavailable', self::page_url() ) );
			exit;
		}

		$payload = get_transient( 'avh2_cart_' . hash( 'sha256', $token ) );
		$auth    = Avenra_Halo_V2_Auth::instance();
		if ( ! is_array( $payload ) || ! $auth->is_authenticated() || (int) $payload['customer_id'] !== $auth->customer_id() ) {
			wp_safe_redirect( add_query_arg( 'shop_error', 'handoff_expired', self::page_url() ) );
			exit;
		}

		if ( function_exists( 'wc_load_cart' ) && ( ! function_exists( 'WC' ) || ! WC()->cart ) ) {
			wc_load_cart();
		}
		if ( ! function_exists( 'WC' ) || ! WC()->cart ) {
			wp_safe_redirect( add_query_arg( 'shop_error', 'checkout_unavailable', self::page_url() ) );
			exit;
		}

		$added = 0;
		foreach ( (array) $payload['items'] as $item ) {
			$product = function_exists( 'wc_get_product' ) ? wc_get_product( (int) $item['product_id'] ) : false;
			if ( $product && $product->is_purchasable() && $product->is_in_stock() && WC()->cart->add_to_cart( $product->get_id(), min( 10, max( 1, (int) $item['quantity'] ) ) ) ) {
				++$added;
			}
		}
		if ( ! $added ) {
			wp_safe_redirect( add_query_arg( 'shop_error', 'items_unavailable', self::page_url() ) );
			exit;
		}

		delete_transient( 'avh2_cart_' . hash( 'sha256', $token ) );
		delete_transient( 'avh2_cart_state_' . $auth->customer_id() );
		wp_safe_redirect( wc_get_checkout_url() );
		exit;
	}

	public static function page_url(): string {
		$page_id = (int) get_option( 'avenra_halo_v2_page_id' );
		$owned   = $page_id && '1' === get_post_meta( $page_id, '_avenra_halo_v2_page', true );
		$url     = $owned ? get_permalink( $page_id ) : false;
		return $url ? (string) $url : home_url( '/halo-v2/' );
	}

	private function serve_manifest(): void {
		$icons = array();
		foreach ( array( 192, 512 ) as $size ) {
			$relative = 'assets/images/halo-icon-' . $size . '.png';
			if ( file_exists( AVENRA_HALO_V2_DIR . $relative ) ) {
				$icons[] = array(
					'src'   => AVENRA_HALO_V2_URL . $relative,
					'sizes' => $size . 'x' . $size,
					'type'  => 'image/png',
					'purpose' => 'any maskable',
				);
			}
		}
		$uploads        = wp_get_upload_dir();
		$uploads_base   = esc_url_raw( (string) ( $uploads['baseurl'] ?? '' ) );
		$screenshots    = array();
		if ( '' !== $uploads_base ) {
			$screenshots[] = array(
				'src'         => trailingslashit( $uploads_base ) . '2026/08/Screenshot_20260826_135648.jpg',
				'sizes'       => '1080x2372',
				'type'        => 'image/jpeg',
				'form_factor' => 'narrow',
				'label'       => 'Halo Safety controls and one-ride monitoring.',
			);
		}

		$manifest = array(
			'id'               => wp_parse_url( self::page_url(), PHP_URL_PATH ) ?: '/halo-v2/',
			'name'             => 'Avenrà Halo',
			'short_name'       => 'Halo',
			'description'      => 'Your Avenrà vehicle, rides and ownership companion.',
			'lang'             => 'en-GB',
			'dir'              => 'ltr',
			'start_url'        => self::page_url(),
			'scope'            => wp_parse_url( self::page_url(), PHP_URL_PATH ) ?: '/halo-v2/',
			'display'          => 'standalone',
			'orientation'      => 'any',
			'background_color' => '#f5f5f2',
			'theme_color'      => '#f5f5f2',
			'categories'       => array( 'lifestyle', 'navigation' ),
			'icons'            => $icons,
			'screenshots'      => $screenshots,
		);

		nocache_headers();
		header( 'CDN-Cache-Control: no-store', true );
		header( 'Cloudflare-CDN-Cache-Control: no-store', true );
		header( 'Surrogate-Control: no-store', true );
		header( 'Content-Type: application/manifest+json; charset=utf-8' );
		echo wp_json_encode( apply_filters( 'avenra_halo_v2_manifest', $manifest ), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		exit;
	}

	private function serve_service_worker(): void {
		$version = rawurlencode( AVENRA_HALO_V2_VERSION );
		$asset_urls = array(
			AVENRA_HALO_V2_URL . 'assets/css/halo-v2.css?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/halo-map.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/ride-engine.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/ride-focus.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/vendor/webtonative/webtonative-1.0.63.min.js?ver=1.0.63',
			AVENRA_HALO_V2_URL . 'assets/js/webtonative-ride.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/bms-bluetooth.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/hypercore-ecu.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/vehicle-specification.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/camera-alignment.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/incident-camera.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/ride-memories.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/js/app.js?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/images/halo-icon-192.png?ver=' . $version,
			AVENRA_HALO_V2_URL . 'assets/images/halo-icon-512.png?ver=' . $version,
			esc_url_raw( (string) apply_filters( 'avenra_halo_v2_logo_white', AVENRA_HALO_V2_LOGO_WHITE ) ),
			esc_url_raw( (string) apply_filters( 'avenra_halo_v2_logo_black', AVENRA_HALO_V2_LOGO_BLACK ) ),
			esc_url_raw( (string) apply_filters( 'avenra_halo_v2_profile_mark_default', AVENRA_HALO_V2_PROFILE_MARK_DEFAULT ) ),
			esc_url_raw( (string) apply_filters( 'avenra_halo_v2_profile_mark_evo', AVENRA_HALO_V2_PROFILE_MARK_EVO ) ),
			esc_url_raw( (string) apply_filters( 'avenra_halo_v2_profile_mark_one', AVENRA_HALO_V2_PROFILE_MARK_ONE ) ),
			esc_url_raw( (string) apply_filters( 'avenra_halo_v2_range_image', AVENRA_HALO_V2_RANGE_IMAGE ) ),
		);
		$asset_urls = array_values( array_unique( (array) apply_filters( 'avenra_halo_v2_service_worker_assets', $asset_urls ) ) );

		$cache_name = 'avenra-halo-v2-static-' . preg_replace( '/[^a-zA-Z0-9._-]/', '-', AVENRA_HALO_V2_VERSION );
		$rest_path  = wp_parse_url( rest_url( 'avenra-halo/v2' ), PHP_URL_PATH ) ?: '/wp-json/avenra-halo/v2';
		$app_path   = wp_parse_url( self::page_url(), PHP_URL_PATH ) ?: '/halo-v2/';
		$plugin_path = wp_parse_url( AVENRA_HALO_V2_URL . 'assets/', PHP_URL_PATH ) ?: '/wp-content/plugins/avenra-halo-v2/assets/';

		nocache_headers();
		header( 'Content-Type: application/javascript; charset=utf-8' );
		header( 'Service-Worker-Allowed: ' . $app_path );
		header( 'Cache-Control: no-cache, no-store, must-revalidate' );
		header( 'CDN-Cache-Control: no-store', true );
		header( 'Cloudflare-CDN-Cache-Control: no-store', true );
		header( 'Surrogate-Control: no-store', true );

		?>
'use strict';
const CACHE_NAME = <?php echo wp_json_encode( $cache_name ); ?>;
const STATIC_ASSETS = <?php echo wp_json_encode( $asset_urls, JSON_UNESCAPED_SLASHES ); ?>;
const REST_PATH = <?php echo wp_json_encode( $rest_path ); ?>;
const APP_PATH = <?php echo wp_json_encode( $app_path ); ?>;
const PLUGIN_ASSET_PATH = <?php echo wp_json_encode( $plugin_path ); ?>;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(STATIC_ASSETS.map(async url => {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'reload' });
      if (response.ok) await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('avenra-halo-v2-static-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Authentication, private HTML, REST data, map tiles, and every mutation are
  // deliberately network-only. The SW can never replay a stale login or ride.
  if (request.method !== 'GET' || request.mode === 'navigate' || url.pathname.startsWith(REST_PATH) || url.pathname.startsWith(APP_PATH)) {
    event.respondWith(fetch(request));
    return;
  }

  if ((url.origin === self.location.origin && url.pathname.startsWith(PLUGIN_ASSET_PATH)) || STATIC_ASSETS.includes(request.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});
		<?php
		exit;
	}
}
