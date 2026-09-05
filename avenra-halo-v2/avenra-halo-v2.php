<?php
/**
 * Plugin Name: Avenrà Halo V2
 * Plugin URI:  https://rideavenra.com/
 * Description: A dedicated, mobile-first Halo owner application. Halo V2 runs alongside the existing Halo page and uses the established Avenrà customer and order records.
 * Version:     2.7.2
 * Author:      Ampera EV Ltd
 * Text Domain: avenra-halo-v2
 * Requires at least: 6.3
 * Requires PHP: 8.0
 */

defined( 'ABSPATH' ) || exit;

define( 'AVENRA_HALO_V2_VERSION', '2.7.2' );
define( 'AVENRA_HALO_V2_FILE', __FILE__ );
define( 'AVENRA_HALO_V2_DIR', plugin_dir_path( __FILE__ ) );
define( 'AVENRA_HALO_V2_URL', plugin_dir_url( __FILE__ ) );
// Use the supplied combined Avenrà/Halo lock-up for every visible application
// brand treatment. The packaged derivative only removes transparent canvas so
// the original artwork remains crisp and correctly proportioned on mobile.
define( 'AVENRA_HALO_V2_BRAND_LOGO_SOURCE', 'https://rideavenra.com/wp-content/uploads/2026/08/avenra-halo-solid-black-transparent.png' );
define( 'AVENRA_HALO_V2_BRAND_LOGO', AVENRA_HALO_V2_URL . 'assets/images/avenra-halo-lockup.png' );
// Retain the established constants and filters for backwards compatibility.
define( 'AVENRA_HALO_V2_LOGO_WHITE_SOURCE', AVENRA_HALO_V2_BRAND_LOGO_SOURCE );
define( 'AVENRA_HALO_V2_LOGO_BLACK_SOURCE', AVENRA_HALO_V2_BRAND_LOGO_SOURCE );
define( 'AVENRA_HALO_V2_LOGO_WHITE', AVENRA_HALO_V2_BRAND_LOGO );
define( 'AVENRA_HALO_V2_LOGO_BLACK', AVENRA_HALO_V2_BRAND_LOGO );
define( 'AVENRA_HALO_V2_RANGE_IMAGE', 'https://rideavenra.com/wp-content/uploads/2026/03/file_00000000e00071fdb0583761e854a132.png' );
define( 'AVENRA_HALO_V2_PROFILE_MARK_DEFAULT', 'https://rideavenra.com/wp-content/uploads/2026/08/file_00000000ea8481f495d8d90ac3ee1292.png' );
define( 'AVENRA_HALO_V2_PROFILE_MARK_EVO', 'https://rideavenra.com/wp-content/uploads/2026/08/file_00000000bdfc81f4be439668e0cbc541.png' );
define( 'AVENRA_HALO_V2_PROFILE_MARK_ONE', 'https://rideavenra.com/wp-content/uploads/2026/08/file_0000000037bc8246a29d947a90e5b159.png' );

require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-response.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-database.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-auth.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-guardian.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-admin.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-legacy-bridge.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-emergency.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-native-ride.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-presence.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-risk.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-operations.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-incident-media.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-community.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-rest.php';
require_once AVENRA_HALO_V2_DIR . 'includes/class-halo-v2-plugin.php';

register_activation_hook( __FILE__, array( 'Avenra_Halo_V2_Plugin', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Avenra_Halo_V2_Plugin', 'deactivate' ) );

Avenra_Halo_V2_Plugin::instance()->boot();
