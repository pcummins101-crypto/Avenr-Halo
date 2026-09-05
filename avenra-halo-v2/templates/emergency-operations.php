<?php

defined( 'ABSPATH' ) || exit;

$halo_operations = is_array( $halo_operations ?? null ) ? $halo_operations : array();
$mode            = sanitize_key( (string) ( $halo_operations['mode'] ?? 'unavailable' ) );
$config          = is_array( $halo_operations['config'] ?? null ) ? $halo_operations['config'] : array();
$csp_nonce       = sanitize_text_field( (string) ( $halo_operations['csp_nonce'] ?? '' ) );
$logo            = esc_url( (string) ( $halo_operations['logo'] ?? '' ) );
$asset_version   = defined( 'AVENRA_HALO_V2_VERSION' ) ? AVENRA_HALO_V2_VERSION : '2.7.2';
$gate_title_id   = 'halo-gate-title-' . $mode;
?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
	<meta name="theme-color" content="#090a0b">
	<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
	<title><?php echo esc_html__( 'Avenrà Emergency Assist', 'avenra-halo-v2' ); ?></title>
	<link rel="stylesheet" href="<?php echo esc_url( AVENRA_HALO_V2_URL . 'assets/css/halo-operations.css?v=' . rawurlencode( $asset_version ) ); ?>">
</head>
<body class="halo-ops-body halo-ops-mode-<?php echo esc_attr( $mode ); ?>">
	<?php if ( 'console' !== $mode ) : ?>
		<main class="halo-ops-gate">
			<section class="halo-ops-gate__card" aria-labelledby="<?php echo esc_attr( $gate_title_id ); ?>">
				<?php if ( $logo ) : ?><img class="halo-ops-gate__logo" src="<?php echo $logo; ?>" alt="Avenrà Halo" width="815" height="303"><?php endif; ?>
				<p class="halo-ops-eyebrow"><span>EMERGENCY ASSIST</span></p>
				<?php if ( 'login' === $mode ) : ?>
					<h1 id="<?php echo esc_attr( $gate_title_id ); ?>"><?php esc_html_e( 'Operator sign in', 'avenra-halo-v2' ); ?></h1>
					<p><?php esc_html_e( 'This private console contains live rider and incident information. Continue with an authorised Avenrà operator account.', 'avenra-halo-v2' ); ?></p>
					<a class="halo-ops-button halo-ops-button--light" href="<?php echo esc_url( (string) ( $halo_operations['login_url'] ?? '' ) ); ?>"><?php esc_html_e( 'Continue securely', 'avenra-halo-v2' ); ?></a>
				<?php elseif ( 'forbidden' === $mode ) : ?>
					<h1 id="<?php echo esc_attr( $gate_title_id ); ?>"><?php esc_html_e( 'Access not authorised', 'avenra-halo-v2' ); ?></h1>
					<p><?php esc_html_e( 'Your WordPress account is signed in but does not have the Emergency Assist viewing capability. Ask an administrator to assign the Avenrà Halo Responder role.', 'avenra-halo-v2' ); ?></p>
					<a class="halo-ops-button halo-ops-button--light" href="<?php echo esc_url( (string) ( $halo_operations['logout_url'] ?? '' ) ); ?>"><?php esc_html_e( 'Use another account', 'avenra-halo-v2' ); ?></a>
				<?php else : ?>
					<h1 id="<?php echo esc_attr( $gate_title_id ); ?>"><?php esc_html_e( 'Console unavailable', 'avenra-halo-v2' ); ?></h1>
					<p><?php esc_html_e( 'Emergency Assist could not start its private operator console.', 'avenra-halo-v2' ); ?></p>
				<?php endif; ?>
				<p class="halo-ops-gate__notice"><span aria-hidden="true"></span><?php esc_html_e( 'Private · no public indexing · operator actions are audited', 'avenra-halo-v2' ); ?></p>
			</section>
		</main>
	<?php else : ?>
		<a class="halo-ops-skip" href="#halo-ops-main"><?php esc_html_e( 'Skip to operations', 'avenra-halo-v2' ); ?></a>
		<div class="halo-ops-shell" data-halo-operations>
			<header class="halo-ops-header">
				<div class="halo-ops-brand">
					<?php if ( $logo ) : ?><img src="<?php echo $logo; ?>" alt="Avenrà Halo" width="815" height="303"><?php endif; ?>
					<small class="halo-ops-brand__service"><?php esc_html_e( 'Emergency Assist', 'avenra-halo-v2' ); ?></small>
				</div>
				<div class="halo-ops-header__status">
					<span class="halo-ops-system-state" data-system-state><i aria-hidden="true"></i><?php esc_html_e( 'Connecting', 'avenra-halo-v2' ); ?></span>
					<button class="halo-ops-operator" type="button" data-operator-menu aria-expanded="false">
						<span><?php echo esc_html( (string) ( $config['operator']['initials'] ?? 'A' ) ); ?></span>
						<b><?php echo esc_html( (string) ( $config['operator']['name'] ?? __( 'Operator', 'avenra-halo-v2' ) ) ); ?></b>
					</button>
					<a class="halo-ops-signout" href="<?php echo esc_url( (string) ( $halo_operations['logout_url'] ?? '' ) ); ?>"><?php esc_html_e( 'Sign out', 'avenra-halo-v2' ); ?></a>
				</div>
			</header>

			<main id="halo-ops-main" class="halo-ops-main">
				<section class="halo-ops-intro">
					<div>
						<p class="halo-ops-eyebrow">AVENRÀ RESPONSE NETWORK</p>
						<h1><?php esc_html_e( 'Emergency Assist', 'avenra-halo-v2' ); ?></h1>
						<p><?php esc_html_e( 'Live operational awareness across riders, journeys and safety incidents.', 'avenra-halo-v2' ); ?></p>
					</div>
					<div class="halo-ops-clock" aria-live="polite"><span data-clock>--:--:--</span><small><?php esc_html_e( 'London · live', 'avenra-halo-v2' ); ?></small></div>
				</section>

				<div class="halo-ops-alert" data-alert role="status" hidden></div>

				<section class="halo-ops-metrics" aria-label="Current operations summary">
					<article class="halo-ops-metric halo-ops-metric--critical"><span><?php esc_html_e( 'Open incidents', 'avenra-halo-v2' ); ?></span><strong data-metric="open_incidents">—</strong><small><?php esc_html_e( 'Real events awaiting handover', 'avenra-halo-v2' ); ?></small></article>
					<article class="halo-ops-metric halo-ops-metric--test-rides"><span><?php esc_html_e( 'Active test rides', 'avenra-halo-v2' ); ?></span><strong data-metric="test_rides">—</strong><small><?php esc_html_e( 'Staff-monitored ride sessions', 'avenra-halo-v2' ); ?></small></article>
					<article class="halo-ops-metric"><span><?php esc_html_e( 'Riding now', 'avenra-halo-v2' ); ?></span><strong data-metric="riding">—</strong><small><?php esc_html_e( 'Consented live ride signals', 'avenra-halo-v2' ); ?></small></article>
					<article class="halo-ops-metric"><span><?php esc_html_e( 'Online', 'avenra-halo-v2' ); ?></span><strong data-metric="online">—</strong><small><span data-metric-inline="signed_in">—</span> <?php esc_html_e( 'currently signed in', 'avenra-halo-v2' ); ?></small></article>
					<article class="halo-ops-metric"><span><?php esc_html_e( 'Rider directory', 'avenra-halo-v2' ); ?></span><strong data-metric="customers">—</strong><small><span data-metric-inline="enrolled">—</span> <?php esc_html_e( 'enrolled in Assist', 'avenra-halo-v2' ); ?></small></article>
				</section>

				<section class="halo-ops-panel halo-ops-incidents" aria-labelledby="halo-incidents-title">
					<div class="halo-ops-panel__head">
						<div><p class="halo-ops-kicker"><?php esc_html_e( 'Response queue', 'avenra-halo-v2' ); ?></p><h2 id="halo-incidents-title"><?php esc_html_e( 'Incidents', 'avenra-halo-v2' ); ?></h2></div>
						<div class="halo-ops-legend"><span class="is-live"><i></i><?php esc_html_e( 'Live', 'avenra-halo-v2' ); ?></span><span class="is-test"><i></i><?php esc_html_e( 'Exercise', 'avenra-halo-v2' ); ?></span></div>
					</div>
					<div class="halo-ops-incident-list" data-incident-list><div class="halo-ops-skeleton halo-ops-skeleton--row"></div><div class="halo-ops-skeleton halo-ops-skeleton--row"></div></div>
				</section>

				<section id="halo-test-rides" class="halo-ops-panel halo-ops-test-rides" aria-labelledby="halo-test-rides-title">
					<div class="halo-ops-panel__head">
						<div><p class="halo-ops-kicker"><?php esc_html_e( 'Fleet awareness', 'avenra-halo-v2' ); ?></p><h2 id="halo-test-rides-title"><?php esc_html_e( 'Active test rides', 'avenra-halo-v2' ); ?></h2></div>
						<span class="halo-ops-test-rides__privacy"><?php esc_html_e( 'Private staff view · refreshes automatically', 'avenra-halo-v2' ); ?></span>
					</div>
					<div class="halo-ops-test-ride-list" data-test-ride-list><div class="halo-ops-skeleton halo-ops-skeleton--test-ride"></div><div class="halo-ops-skeleton halo-ops-skeleton--test-ride"></div></div>
					<p class="halo-ops-footnote"><?php esc_html_e( 'Only active, non-expired rides explicitly marked for Avenrà test-ride monitoring appear here. A delayed signal shows the last accepted position and never implies that the motorcycle is still moving.', 'avenra-halo-v2' ); ?></p>
				</section>

				<section class="halo-ops-panel halo-ops-riders" aria-labelledby="halo-riders-title">
					<div class="halo-ops-panel__head halo-ops-panel__head--stack">
						<div><p class="halo-ops-kicker"><?php esc_html_e( 'Operational awareness', 'avenra-halo-v2' ); ?></p><h2 id="halo-riders-title"><?php esc_html_e( 'Riders', 'avenra-halo-v2' ); ?></h2></div>
						<form class="halo-ops-filter" data-rider-filter role="search">
							<label><span class="screen-reader-text"><?php esc_html_e( 'Search riders', 'avenra-halo-v2' ); ?></span><input type="search" name="search" placeholder="Search name, email, bike or registration" autocomplete="off"></label>
							<label><span class="screen-reader-text"><?php esc_html_e( 'Filter rider status', 'avenra-halo-v2' ); ?></span><select name="status"><option value="all"><?php esc_html_e( 'All riders', 'avenra-halo-v2' ); ?></option><option value="riding"><?php esc_html_e( 'Riding now', 'avenra-halo-v2' ); ?></option><option value="signal_lost"><?php esc_html_e( 'Ride signal lost', 'avenra-halo-v2' ); ?></option><option value="online"><?php esc_html_e( 'Online', 'avenra-halo-v2' ); ?></option><option value="signed_in"><?php esc_html_e( 'Signed in', 'avenra-halo-v2' ); ?></option><option value="offline"><?php esc_html_e( 'Offline', 'avenra-halo-v2' ); ?></option><option value="monitoring_off"><?php esc_html_e( 'Assist not consented', 'avenra-halo-v2' ); ?></option><option value="risk_attention"><?php esc_html_e( 'Risk attention', 'avenra-halo-v2' ); ?></option></select></label>
							<button type="submit" class="halo-ops-button halo-ops-button--dark"><?php esc_html_e( 'Apply', 'avenra-halo-v2' ); ?></button>
						</form>
					</div>
					<div class="halo-ops-table-wrap">
						<table class="halo-ops-table">
							<thead><tr><th><?php esc_html_e( 'Rider', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Halo status', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Motorcycle', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Live ride', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Ride-risk indicator', 'avenra-halo-v2' ); ?></th></tr></thead>
							<tbody data-rider-list><tr><td colspan="5"><div class="halo-ops-skeleton halo-ops-skeleton--table"></div></td></tr></tbody>
						</table>
					</div>
					<div class="halo-ops-pagination" data-pagination></div>
					<p class="halo-ops-footnote"><?php esc_html_e( 'Riding status, live speed and location are only displayed while current Emergency Assist consent and a recent heartbeat are present. The risk indicator summarises ride history; it is not an accident prediction or insurance score.', 'avenra-halo-v2' ); ?></p>
				</section>

				<?php if ( ! empty( $config['capabilities']['drill'] ) ) : ?>
				<section class="halo-ops-panel halo-ops-test-lab" aria-labelledby="halo-test-title">
					<div class="halo-ops-panel__head">
						<div><p class="halo-ops-kicker"><?php esc_html_e( 'Controlled validation', 'avenra-halo-v2' ); ?></p><h2 id="halo-test-title"><?php esc_html_e( 'Emergency Assist test lab', 'avenra-halo-v2' ); ?></h2></div>
						<span class="halo-ops-test-badge">TEST ENVIRONMENT</span>
					</div>
					<div class="halo-ops-test-grid">
						<div class="halo-ops-test-copy"><h3><?php esc_html_e( 'Prove the complete workflow safely', 'avenra-halo-v2' ); ?></h3><p><?php esc_html_e( 'Dry run creates an encrypted incident and exercises escalation logic without contacting either responder. Live SMS is separately guarded and every message is marked as a test.', 'avenra-halo-v2' ); ?></p><ul><li><?php esc_html_e( 'No 999 or next-of-kin actions in test incidents', 'avenra-halo-v2' ); ?></li><li><?php esc_html_e( 'Every drill and operator action is timestamped', 'avenra-halo-v2' ); ?></li><li><?php esc_html_e( 'Use consented test accounts only', 'avenra-halo-v2' ); ?></li></ul></div>
						<form class="halo-ops-test-form" data-test-form>
							<label><span><?php esc_html_e( 'Test rider', 'avenra-halo-v2' ); ?></span><select name="customer_id" required data-test-customer><option value=""><?php esc_html_e( 'Choose a consented rider', 'avenra-halo-v2' ); ?></option></select></label>
							<div class="halo-ops-field-pair"><label><span><?php esc_html_e( 'Dispatch', 'avenra-halo-v2' ); ?></span><select name="mode" data-test-mode><option value="dry_run"><?php esc_html_e( 'Dry run · no SMS', 'avenra-halo-v2' ); ?></option><option value="live_sms"><?php esc_html_e( 'Live responder SMS', 'avenra-halo-v2' ); ?></option></select></label><label><span><?php esc_html_e( 'Scenario', 'avenra-halo-v2' ); ?></span><select name="scenario"><option value="happy_path"><?php esc_html_e( 'Happy path', 'avenra-halo-v2' ); ?></option><option value="primary_rejected"><?php esc_html_e( 'Primary rejected', 'avenra-halo-v2' ); ?></option><option value="primary_timeout"><?php esc_html_e( 'Primary timeout', 'avenra-halo-v2' ); ?></option><option value="no_ack_fallback"><?php esc_html_e( 'No acknowledgement fallback', 'avenra-halo-v2' ); ?></option></select></label></div>
							<div class="halo-ops-field-pair"><label><span><?php esc_html_e( 'Speed (mph)', 'avenra-halo-v2' ); ?></span><input type="number" name="speed_mph" value="42" min="0" max="180" step="0.1"></label><label><span><?php esc_html_e( 'Peak G', 'avenra-halo-v2' ); ?></span><input type="number" name="peak_g_force" value="2.6" min="0" max="20" step="0.1"></label></div>
							<div class="halo-ops-field-pair"><label><span><?php esc_html_e( 'Latitude', 'avenra-halo-v2' ); ?></span><input type="number" name="lat" value="53.7185" min="-90" max="90" step="0.000001"></label><label><span><?php esc_html_e( 'Longitude', 'avenra-halo-v2' ); ?></span><input type="number" name="lng" value="-1.2591" min="-180" max="180" step="0.000001"></label></div>
							<label class="halo-ops-live-confirm" data-live-confirm hidden><span><?php esc_html_e( 'Type SEND TEST SMS to confirm', 'avenra-halo-v2' ); ?></span><input type="text" name="confirmation" autocomplete="off" placeholder="SEND TEST SMS"></label>
							<div class="halo-ops-test-readiness" data-test-readiness></div>
							<button type="submit" class="halo-ops-button halo-ops-button--red" data-test-submit><?php esc_html_e( 'Create dry-run incident', 'avenra-halo-v2' ); ?></button>
						</form>
					</div>
				</section>
				<?php endif; ?>
			</main>

			<footer class="halo-ops-footer"><p class="halo-ops-footer__brand"><?php if ( $logo ) : ?><img src="<?php echo $logo; ?>" alt="Avenrà Halo" width="815" height="303"><?php else : ?><strong>AVENRÀ HALO</strong><?php endif; ?><span aria-hidden="true">·</span> <?php esc_html_e( 'Private Emergency Assist operations', 'avenra-halo-v2' ); ?></p><p><?php esc_html_e( 'Telemetry supports human judgement. It does not contact emergency services automatically.', 'avenra-halo-v2' ); ?></p></footer>

			<div class="halo-ops-drawer" data-incident-drawer aria-hidden="true">
				<div class="halo-ops-drawer__backdrop" data-close-drawer></div>
				<aside class="halo-ops-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="halo-drawer-title">
					<div class="halo-ops-drawer__head"><div><p class="halo-ops-kicker"><?php esc_html_e( 'Incident briefing', 'avenra-halo-v2' ); ?></p><h2 id="halo-drawer-title"><?php esc_html_e( 'Loading incident…', 'avenra-halo-v2' ); ?></h2></div><button type="button" class="halo-ops-drawer__close" data-close-drawer aria-label="<?php esc_attr_e( 'Close incident', 'avenra-halo-v2' ); ?>">×</button></div>
					<div class="halo-ops-drawer__body" data-drawer-body><div class="halo-ops-skeleton halo-ops-skeleton--detail"></div></div>
				</aside>
			</div>
		</div>
		<script nonce="<?php echo esc_attr( $csp_nonce ); ?>" id="avenra-halo-operations-config" type="application/json"><?php echo wp_json_encode( $config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT ); ?></script>
		<script defer src="<?php echo esc_url( AVENRA_HALO_V2_URL . 'assets/js/halo-operations.js?v=' . rawurlencode( $asset_version ) ); ?>"></script>
	<?php endif; ?>
</body>
</html>
