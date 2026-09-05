<?php
/**
 * Avenra Halo v2 uninstall routine.
 *
 * Customer, order, ride and safety data are intentionally preserved unless an
 * administrator explicitly opts into destructive cleanup before uninstalling.
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	    exit;
}

// Guardian notifications can outlive the request that scheduled them. Always
// remove both scheduler variants, even when customer data is being preserved.
wp_clear_scheduled_hook( 'avenra_halo_v2_guardian_sms_fallback' );
if ( function_exists( 'as_unschedule_all_actions' ) ) {
	as_unschedule_all_actions( 'avenra_halo_v2_guardian_sms_fallback', array(), 'avenra-halo-v2' );
}

if ( ! defined( 'AVENRA_HALO_V2_PURGE_ON_UNINSTALL' ) || true !== AVENRA_HALO_V2_PURGE_ON_UNINSTALL ) {
    return;
}

global $wpdb;

$purge_directory = static function ( string $directory, string $required_incident_marker = '', string $required_basename = '' ): void {
	if ( '' === $directory || ! is_dir( $directory ) ) {
		return;
	}
	$real_directory = realpath( $directory );
	if ( false === $real_directory || DIRECTORY_SEPARATOR === $real_directory ) {
		return;
	}
	if ( '' !== $required_basename && ! hash_equals( $required_basename, basename( $real_directory ) ) ) {
		return;
	}
	if ( '' !== $required_incident_marker ) {
		$marker = trailingslashit( $real_directory ) . '.avenra-halo-v2-incident-media';
		if ( ! is_file( $marker ) || ! hash_equals( $required_incident_marker, trim( (string) file_get_contents( $marker ) ) ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			return;
		}
	}
	try {
		$iterator = new RecursiveIteratorIterator(
			new RecursiveDirectoryIterator( $real_directory, FilesystemIterator::SKIP_DOTS ),
			RecursiveIteratorIterator::CHILD_FIRST
		);
		foreach ( $iterator as $item ) {
			$path = $item->getPathname();
			if ( $item->isLink() || $item->isFile() ) {
				@unlink( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.unlink_unlink
			} elseif ( $item->isDir() ) {
				@rmdir( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
			}
		}
		@rmdir( $real_directory ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
	} catch ( UnexpectedValueException $error ) {
		do_action( 'avenra_halo_v2_purge_storage_error', $error->getMessage() );
	}
};

$uploads           = wp_upload_dir();
$private_directory = empty( $uploads['error'] ) ? trailingslashit( $uploads['basedir'] ) . 'avenra-halo-v2-private' : '';
$purge_directory( $private_directory );

$incident_scope_hash = substr(
	hash(
		'sha256',
		strtolower( untrailingslashit( (string) home_url( '/' ) ) )
			. '|' . wp_normalize_path( untrailingslashit( ABSPATH ) )
			. '|' . (string) $wpdb->prefix
			. '|' . get_current_blog_id()
	),
	0,
	16
);
$incident_scope_name = 'site-' . get_current_blog_id() . '-' . $incident_scope_hash;
$incident_scope_suffix = '/' . $incident_scope_name;
$incident_marker = 'avenra-halo-v2-incident-media:' . $incident_scope_hash;
$incident_directories = array();
$remembered_incident_directory = get_option( 'avenra_halo_v2_incident_media_storage_root', '' );
if ( is_string( $remembered_incident_directory ) && '' !== trim( $remembered_incident_directory ) ) {
	$incident_directories[] = $remembered_incident_directory;
}
if ( defined( 'AVENRA_HALO_V2_PRIVATE_STORAGE_DIR' ) && is_string( AVENRA_HALO_V2_PRIVATE_STORAGE_DIR ) ) {
	$incident_directories[] = untrailingslashit( AVENRA_HALO_V2_PRIVATE_STORAGE_DIR ) . '/incident-media' . $incident_scope_suffix;
}
$incident_directories[] = trailingslashit( dirname( untrailingslashit( ABSPATH ) ) ) . 'avenra-halo-private/incident-media' . $incident_scope_suffix;
$incident_directories[] = trailingslashit( WP_CONTENT_DIR ) . 'avenra-halo-private/incident-media' . $incident_scope_suffix;
foreach ( array_unique( $incident_directories ) as $incident_directory ) {
	$purge_directory( (string) $incident_directory, $incident_marker, $incident_scope_name );
}

$vehicle_photo_ids = get_posts(
    array(
        'post_type'      => 'attachment',
        'post_status'    => 'any',
        'posts_per_page' => -1,
        'fields'         => 'ids',
        'meta_key'       => '_avenra_halo_v2_vehicle_photo_customer_id',
    )
);
foreach ( $vehicle_photo_ids as $attachment_id ) {
    wp_delete_attachment( (int) $attachment_id, true );
}

$tables = array(
    $wpdb->prefix . 'avenra_halo_v2_sessions',
    $wpdb->prefix . 'avenra_halo_v2_rides',
    $wpdb->prefix . 'avenra_halo_v2_hazards',
	$wpdb->prefix . 'avenra_halo_v2_live_tracking',
	$wpdb->prefix . 'avenra_halo_v2_native_ride_sessions',
	$wpdb->prefix . 'avenra_halo_v2_documents',
	$wpdb->prefix . 'avenra_halo_v2_vehicle_photos',
	$wpdb->prefix . 'avenra_halo_v2_emergency_settings',
	$wpdb->prefix . 'avenra_halo_v2_emergency_consent_events',
	$wpdb->prefix . 'avenra_halo_v2_incidents',
	$wpdb->prefix . 'avenra_halo_v2_incident_events',
	$wpdb->prefix . 'avenra_halo_v2_incident_media_grants',
	$wpdb->prefix . 'avenra_halo_v2_incident_media',
	$wpdb->prefix . 'avenra_halo_v2_presence',
	$wpdb->prefix . 'avenra_halo_v2_risk_profiles',
	$wpdb->prefix . 'avenra_halo_v2_operations_audit',
	$wpdb->prefix . 'avenra_halo_v2_community_moderation_events',
	$wpdb->prefix . 'avenra_halo_v2_community_reports',
	$wpdb->prefix . 'avenra_halo_v2_community_blocks',
	$wpdb->prefix . 'avenra_halo_v2_community_messages',
	$wpdb->prefix . 'avenra_halo_v2_community_conversations',
	$wpdb->prefix . 'avenra_halo_v2_community_replies',
	$wpdb->prefix . 'avenra_halo_v2_community_threads',
	$wpdb->prefix . 'avenra_halo_v2_community_profiles',
);

foreach ( $tables as $table ) {
    $wpdb->query( 'DROP TABLE IF EXISTS `' . esc_sql( $table ) . '`' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.SchemaChange
}

$page_id = (int) get_option( 'avenra_halo_v2_page_id', 0 );
if ( $page_id > 0 ) {
    wp_trash_post( $page_id );
}

delete_option( 'avenra_halo_v2_page_id' );
delete_option( 'avenra_halo_v2_db_version' );
delete_option( 'avenra_halo_v2_incident_media_schema_version' );
delete_option( 'avenra_halo_v2_incident_media_storage_root' );
delete_option( 'avenra_halo_v2_operations_caps_version' );
delete_option( 'avenra_halo_v2_community_cap_version' );
$administrator = get_role( 'administrator' );
if ( $administrator instanceof WP_Role ) {
	foreach ( array( 'avenra_halo_emergency_view', 'avenra_halo_emergency_operate', 'avenra_halo_emergency_drill', 'avenra_halo_emergency_medical' ) as $capability ) {
		$administrator->remove_cap( $capability );
	}
	$administrator->remove_cap( 'avenra_halo_community_moderate' );
}
remove_role( 'avenra_halo_responder' );
wp_clear_scheduled_hook( 'avenra_halo_v2_cleanup' );
wp_clear_scheduled_hook( 'avenra_halo_v2_emergency_activate_candidate' );
wp_clear_scheduled_hook( 'avenra_halo_v2_emergency_escalate' );
wp_clear_scheduled_hook( 'avenra_halo_v2_emergency_enrich' );
if ( function_exists( 'as_unschedule_all_actions' ) ) {
	as_unschedule_all_actions( 'avenra_halo_v2_emergency_activate_candidate', array(), 'avenra-halo-v2' );
	as_unschedule_all_actions( 'avenra_halo_v2_emergency_escalate', array(), 'avenra-halo-v2' );
	as_unschedule_all_actions( 'avenra_halo_v2_emergency_enrich', array(), 'avenra-halo-v2' );
}

// Remove fallback database transients. Object-cache-backed transients expire
// independently and contain no raw session, CSRF, PIN, OTP or tracking token.
$transient_patterns = array(
    $wpdb->esc_like( '_transient_avh2_' ) . '%',
    $wpdb->esc_like( '_transient_timeout_avh2_' ) . '%',
    $wpdb->esc_like( '_site_transient_avh2_' ) . '%',
    $wpdb->esc_like( '_site_transient_timeout_avh2_' ) . '%',
);
foreach ( $transient_patterns as $pattern ) {
    $wpdb->query( $wpdb->prepare( "DELETE FROM `{$wpdb->options}` WHERE option_name LIKE %s", $pattern ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared
}
