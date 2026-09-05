<?php

defined( 'ABSPATH' ) || exit;

$mode = sanitize_key( (string) ( $halo_emergency['mode'] ?? 'unavailable' ) );
$logo = esc_url( (string) ( $halo_emergency['logo'] ?? AVENRA_HALO_V2_LOGO_BLACK ) );
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
	<meta name="referrer" content="no-referrer">
	<title><?php echo esc_html__( 'Avenrà Halo Emergency Assist', 'avenra-halo-v2' ); ?></title>
	<link rel="stylesheet" href="<?php echo esc_url( AVENRA_HALO_V2_URL . 'assets/css/halo-emergency.css?ver=' . rawurlencode( AVENRA_HALO_V2_VERSION ) ); ?>">
</head>
<body class="halo-assist-body">
	<main class="halo-assist-shell">
		<header class="halo-assist-brand">
			<?php if ( $logo ) : ?>
				<img src="<?php echo $logo; ?>" alt="Avenrà Halo" width="815" height="303">
			<?php else : ?>
				<strong>AVENRÀ HALO</strong>
			<?php endif; ?>
			<span>EMERGENCY ASSIST</span>
		</header>

		<?php if ( 'exchange' === $mode ) : ?>
			<section class="halo-assist-centre" aria-live="polite">
				<div class="halo-assist-spinner" aria-hidden="true"></div>
				<p class="halo-assist-kicker">SECURE INCIDENT ACCESS</p>
				<h1>Opening the private response dashboard</h1>
				<p class="halo-assist-muted halo-assist-exchange-status">Checking this device’s response link…</p>
				<noscript><p class="halo-assist-alert halo-assist-alert--error">JavaScript is required once to exchange the private link securely. The link itself does not acknowledge an incident.</p></noscript>
			</section>
			<script nonce="<?php echo esc_attr( (string) $halo_emergency['csp_nonce'] ); ?>">
			(() => {
				'use strict';
				const status = document.querySelector('.halo-assist-exchange-status');
				let token = '';
				try { token = decodeURIComponent(window.location.hash.slice(1)); } catch (error) { token = ''; }
				window.history.replaceState(null, document.title, window.location.pathname);
				if (!/^[A-Za-z0-9_-]{40,90}$/.test(token)) {
					status.textContent = 'This private Emergency Assist link is unavailable or has expired.';
					return;
				}
				const body = new URLSearchParams({
					emergency_action: 'exchange',
					exchange_nonce: <?php echo wp_json_encode( (string) $halo_emergency['exchange_nonce'] ); ?>,
					token
				});
				fetch(window.location.pathname, {
					method: 'POST',
					credentials: 'same-origin',
					cache: 'no-store',
					redirect: 'error',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
					body: body.toString()
				}).then(response => response.ok ? response.json() : Promise.reject(new Error('unavailable')))
				  .then(result => {
					  token = '';
					  if (!result || result.success !== true) throw new Error('unavailable');
					  const dashboardUrl = new URL(String(result.dashboard_url || ''), window.location.origin);
					  if (dashboardUrl.origin !== window.location.origin || !dashboardUrl.searchParams.get('incident') || !['primary', 'backup'].includes(dashboardUrl.searchParams.get('role'))) throw new Error('unavailable');
					  window.location.replace(dashboardUrl.href);
				  })
				  .catch(() => {
					  token = '';
					  status.textContent = 'This private Emergency Assist link is unavailable or has expired.';
				  });
			})();
			</script>

		<?php elseif ( 'dashboard' === $mode ) :
			$incident    = $halo_emergency['incident'];
			$snapshot    = is_array( $halo_emergency['snapshot'] ?? null ) ? $halo_emergency['snapshot'] : array();
			$rider       = is_array( $snapshot['rider'] ?? null ) ? $snapshot['rider'] : array();
			$medical     = is_array( $snapshot['medical'] ?? null ) ? $snapshot['medical'] : array();
			$bike        = is_array( $snapshot['bike'] ?? null ) ? $snapshot['bike'] : array();
			$location    = is_array( $snapshot['location'] ?? null ) ? $snapshot['location'] : array();
			$impact_location = is_array( $snapshot['impact_location'] ?? null ) ? $snapshot['impact_location'] : $location;
			$impact      = is_array( $snapshot['impact'] ?? null ) ? $snapshot['impact'] : array();
				$device       = is_array( $snapshot['device'] ?? null ) ? $snapshot['device'] : array();
				$network      = is_array( $snapshot['network'] ?? null ) ? $snapshot['network'] : array();
				$ride_context = is_array( $snapshot['ride_context'] ?? null ) ? $snapshot['ride_context'] : array();
				$planned_route = is_array( $snapshot['planned_route'] ?? null ) ? $snapshot['planned_route'] : array();
			$events      = is_array( $halo_emergency['events'] ?? null ) ? $halo_emergency['events'] : array();
			$route       = is_array( $halo_emergency['route_points'] ?? null ) ? $halo_emergency['route_points'] : array();
			$telemetry   = is_array( $snapshot['recent_telemetry'] ?? null ) ? array_slice( $snapshot['recent_telemetry'], -12 ) : array();
				$csrf        = (string) ( $halo_emergency['csrf'] ?? '' );
				$dashboard_url = (string) ( $halo_emergency['dashboard_url'] ?? home_url( '/halo-assist/' ) );
			$is_test     = '1' === (string) ( $incident->is_test ?? '0' ) || in_array( (string) ( $incident->source ?? '' ), array( 'test', 'simulation' ), true );
				$acknowledged = null !== ( $incident->first_acknowledged_at ?? null );
				$authoritative = $acknowledged && hash_equals( (string) ( $incident->first_acknowledged_by ?? '' ), (string) ( $halo_emergency['role'] ?? '' ) );
			$terminal    = in_array( (string) ( $incident->status ?? '' ), array( 'cancelled', 'false_alarm', 'resolved' ), true );
			$notice      = is_array( $halo_emergency['notice'] ?? null ) ? $halo_emergency['notice'] : null;
			$event_labels= array(
				'test_candidate'           => 'Test incident created',
				'candidate'                => 'Crash candidate recorded',
				'cancellation'             => 'Rider cancelled alert',
				'activation'               => 'Emergency Assist activated',
				'provider_attempt'         => 'Responder SMS attempted',
				'provider_acceptance'      => 'Responder SMS accepted',
					'provider_failure'         => 'Responder SMS not confirmed',
					'backup_escalation'        => 'Backup responder escalation',
				'dashboard_open'           => 'Dashboard opened',
				'first_acknowledgement'    => 'First acknowledgement',
				'rider_call_result'        => 'Rider contact result',
				'999_called'               => 'Human reported calling 999',
				'nok_notification_outcome' => 'Next-of-kin notification result',
				'false_alarm'              => 'False alarm recorded',
				'handover_complete'        => 'Handover completed',
				'resolution'               => 'Incident resolved',
				'test_complete'            => 'Test exercise completed',
			);
			?>
			<section class="halo-assist-hero">
				<div>
					<p class="halo-assist-kicker"><?php echo $is_test ? 'CONTROLLED TEST EXERCISE' : 'ACTIVE INCIDENT'; ?> · <?php echo esc_html( strtoupper( (string) $incident->public_id ) ); ?></p>
					<h1><?php echo $is_test ? 'Emergency Assist test dashboard' : 'Emergency response dashboard'; ?></h1>
					<p class="halo-assist-muted"><?php echo esc_html( (string) $halo_emergency['role_label'] ); ?> · link possession identifies this device role, not a verified person.</p>
				</div>
				<span class="halo-assist-status halo-assist-status--<?php echo esc_attr( sanitize_html_class( (string) $incident->status ) ); ?>"><?php echo esc_html( ucwords( str_replace( '_', ' ', (string) $incident->status ) ) ); ?></span>
			</section>

			<?php if ( $notice ) : ?>
				<div class="halo-assist-alert halo-assist-alert--<?php echo 'success' === ( $notice['type'] ?? '' ) ? 'success' : 'error'; ?>" role="status"><?php echo esc_html( (string) ( $notice['message'] ?? '' ) ); ?></div>
			<?php endif; ?>

			<?php if ( $is_test ) : ?>
				<div class="halo-assist-alert halo-assist-alert--critical" role="alert"><strong>TEST EXERCISE — NO ACCIDENT — DO NOT CALL 999.</strong> No rider, emergency service or next of kin should be contacted from this exercise.</div>
			<?php else : ?>
				<div class="halo-assist-alert halo-assist-alert--critical"><strong>Halo has not called 999.</strong> If there is immediate danger, call emergency services now. Treat this electric motorcycle as a potential high-voltage hazard.</div>
			<?php endif; ?>

			<?php if ( ! $is_test ) : ?><section class="halo-assist-card halo-assist-card--script">
				<p class="halo-assist-kicker">SUGGESTED 999 OPENING</p>
				<blockquote>“Ambulance, please. I’m calling from Avenrà Emergency Assist about an automatically detected motorcycle collision. The rider is <?php echo esc_html( 'no_answer' === (string) ( $incident->rider_call_result ?? '' ) ? 'not answering our callback' : ( 'accident_confirmed' === (string) ( $incident->rider_call_result ?? '' ) ? 'confirming an accident' : 'not yet confirmed' ) ); ?>. The electric motorcycle is at <?php echo esc_html( (string) ( $location['address'] ?? '' ) ?: ( isset( $location['lat'], $location['lng'] ) ? number_format( (float) $location['lat'], 6 ) . ', ' . number_format( (float) $location['lng'], 6 ) : 'an unresolved location' ) ); ?>. Incident <?php echo esc_html( (string) $incident->public_id ); ?>. I have precise coordinates and incident telemetry.”</blockquote>
				<p class="halo-assist-muted">Be ready to state what has happened, the exact location and a reliable callback number. Answer the call handler’s questions and follow their instructions.</p>
			</section><?php endif; ?>

			<?php if ( ! $acknowledged && ! $terminal ) : ?>
				<section class="halo-assist-card halo-assist-card--action">
					<p class="halo-assist-kicker">FIRST RESPONSE</p>
					<h2>Acknowledge before taking action</h2>
					<p>Enter your name or initials. The first acknowledgement wins atomically; the response-device role remains separate attribution and is not conclusive identity proof.</p>
					<form method="post" action="<?php echo esc_url( $dashboard_url ); ?>">
						<input type="hidden" name="emergency_action" value="acknowledge">
						<input type="hidden" name="emergency_csrf" value="<?php echo esc_attr( $csrf ); ?>">
						<label><span>Name or initials</span><input type="text" name="responder_name" minlength="2" maxlength="80" autocomplete="name" required></label>
						<button type="submit" class="halo-assist-button halo-assist-button--dark">Acknowledge incident</button>
					</form>
				</section>
			<?php elseif ( $acknowledged ) : ?>
				<div class="halo-assist-alert halo-assist-alert--success"><strong>Acknowledged first by <?php echo esc_html( (string) ( $incident->first_acknowledged_by ?? 'responder' ) ); ?> response device<?php echo ! empty( $halo_emergency['acknowledger_name'] ) ? ' · ' . esc_html( (string) $halo_emergency['acknowledger_name'] ) : ''; ?>.</strong></div>
				<?php if ( ! $authoritative && ! $terminal ) : ?><div class="halo-assist-alert halo-assist-alert--error">This device has read-only access. Only the device that recorded the first acknowledgement can submit response actions.</div><?php endif; ?>
			<?php endif; ?>

			<?php if ( ! empty( $halo_emergency['snapshot_unavailable'] ) ) : ?>
				<div class="halo-assist-alert halo-assist-alert--error">The protected incident snapshot could not be decrypted. The audit timeline remains available.</div>
			<?php endif; ?>

			<div class="halo-assist-grid halo-assist-grid--top">
				<section class="halo-assist-card">
					<p class="halo-assist-kicker">RIDER</p>
					<h2><?php echo esc_html( (string) ( $rider['name'] ?? 'Identity not supplied' ) ); ?></h2>
					<?php if ( ! $is_test && ! empty( $rider['mobile'] ) ) : ?><a class="halo-assist-button halo-assist-button--call" href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', (string) $rider['mobile'] ) ); ?>">Call rider</a><?php endif; ?>
					<dl class="halo-assist-facts">
						<div><dt>Call result</dt><dd><?php echo esc_html( ucwords( str_replace( '_', ' ', (string) ( $incident->rider_call_result ?? 'Not recorded' ) ) ) ); ?></dd></div>
						<div><dt>Impact time</dt><dd><?php echo esc_html( (string) ( $impact['occurred_at'] ?? $incident->occurred_at ) ); ?></dd></div>
						<div><dt>Email</dt><dd><?php echo esc_html( (string) ( $rider['email'] ?? 'Not supplied' ) ); ?></dd></div>
						<div><dt>Home address</dt><dd><?php echo esc_html( trim( (string) ( $rider['home_address'] ?? '' ) . ' ' . (string) ( $rider['postcode'] ?? '' ) ) ?: 'Not supplied' ); ?></dd></div>
					</dl>
				</section>

				<section class="halo-assist-card">
					<p class="halo-assist-kicker">MOTORCYCLE · ELECTRIC / HIGH VOLTAGE</p>
					<h2><?php echo esc_html( (string) ( $bike['model'] ?? 'Avenrà motorcycle' ) ); ?></h2>
					<dl class="halo-assist-facts">
						<div><dt>Registration</dt><dd><?php echo esc_html( (string) ( $bike['registration'] ?? 'Not supplied' ) ); ?></dd></div>
						<div><dt>Colour</dt><dd><?php echo esc_html( (string) ( $bike['colour'] ?? 'Not supplied' ) ); ?></dd></div>
						<div><dt>VIN</dt><dd><?php echo esc_html( (string) ( $bike['vin'] ?? 'Not supplied' ) ); ?></dd></div>
						<div><dt>Ride reference</dt><dd><?php echo esc_html( (string) ( $ride_context['client_ride_id'] ?? 'Not supplied' ) ); ?></dd></div>
					</dl>
					<p class="halo-assist-hv-warning"><?php echo esc_html( (string) ( $bike['ev_hv_warning'] ?? 'Do not touch damaged high-voltage components or charge the motorcycle after a collision.' ) ); ?></p>
				</section>
			</div>

			<section class="halo-assist-card halo-assist-location">
				<div class="halo-assist-card-heading"><div><p class="halo-assist-kicker">LATEST EXACT LOCATION</p><h2><?php echo esc_html( (string) ( $location['address'] ?? 'Address not resolved' ) ); ?></h2></div><?php if ( ! empty( $halo_emergency['map_url'] ) ) : ?><a class="halo-assist-button halo-assist-button--light" href="<?php echo esc_url( (string) $halo_emergency['map_url'] ); ?>" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open in OpenStreetMap</a><?php endif; ?></div>
				<dl class="halo-assist-facts halo-assist-facts--wide">
					<div><dt>Latitude</dt><dd><?php echo esc_html( isset( $location['lat'] ) ? number_format( (float) $location['lat'], 6 ) : 'Unavailable' ); ?></dd></div>
					<div><dt>Longitude</dt><dd><?php echo esc_html( isset( $location['lng'] ) ? number_format( (float) $location['lng'], 6 ) : 'Unavailable' ); ?></dd></div>
					<div><dt>GPS accuracy</dt><dd><?php echo esc_html( isset( $location['accuracy_m'] ) ? round( (float) $location['accuracy_m'] ) . ' m' : 'Unavailable' ); ?></dd></div>
					<div><dt>GPS timestamp</dt><dd><?php echo esc_html( (string) ( $location['timestamp'] ?? 'Unavailable' ) ); ?></dd></div>
					<div><dt>Altitude</dt><dd><?php echo esc_html( isset( $location['altitude_m'] ) ? round( (float) $location['altitude_m'], 1 ) . ' m' : 'Unavailable' ); ?></dd></div>
					<div><dt>Heading</dt><dd><?php echo esc_html( isset( $location['heading'] ) ? round( (float) $location['heading'] ) . '°' : 'Unavailable' ); ?></dd></div>
					<div><dt>Movement</dt><dd><?php echo esc_html( (string) ( $location['movement'] ?? 'Unavailable' ) ); ?></dd></div>
					<div><dt>Location source</dt><dd><?php echo esc_html( (string) ( $location['source'] ?? 'Unavailable' ) ); ?></dd></div>
				</dl>
				<?php if ( $impact_location ) : ?>
					<div class="halo-assist-impact-location"><p class="halo-assist-kicker">IMMUTABLE IMPACT LOCATION</p><p><strong><?php echo esc_html( (string) ( $impact_location['address'] ?? 'Address not resolved' ) ); ?></strong><br><?php echo esc_html( isset( $impact_location['lat'], $impact_location['lng'] ) ? number_format( (float) $impact_location['lat'], 6 ) . ', ' . number_format( (float) $impact_location['lng'], 6 ) : 'Coordinates unavailable' ); ?><?php echo ! empty( $impact_location['timestamp'] ) ? ' · ' . esc_html( (string) $impact_location['timestamp'] ) : ''; ?></p></div>
				<?php endif; ?>
				<?php if ( $planned_route ) : ?><p class="halo-assist-muted"><strong>Planned route:</strong> <?php echo esc_html( trim( (string) ( $planned_route['start_label'] ?? '' ) . ' → ' . (string) ( $planned_route['destination_label'] ?? '' ), ' →' ) ?: (string) ( $planned_route['title'] ?? 'Route supplied' ) ); ?><?php echo isset( $planned_route['distance_miles'] ) ? ' · ' . esc_html( round( (float) $planned_route['distance_miles'], 1 ) . ' mi' ) : ''; ?></p><?php endif; ?>

				<?php if ( count( $route ) > 1 ) :
					$lats = array_column( $route, 'lat' );
					$lngs = array_column( $route, 'lng' );
					$min_lat = min( $lats ); $max_lat = max( $lats ); $min_lng = min( $lngs ); $max_lng = max( $lngs );
					$lat_span = max( 0.000001, $max_lat - $min_lat ); $lng_span = max( 0.000001, $max_lng - $min_lng );
					$svg_points = array();
					foreach ( $route as $point ) {
						$x = 20 + ( ( (float) $point['lng'] - $min_lng ) / $lng_span ) * 560;
						$y = 200 - ( ( (float) $point['lat'] - $min_lat ) / $lat_span ) * 180;
						$svg_points[] = number_format( $x, 1, '.', '' ) . ',' . number_format( $y, 1, '.', '' );
					}
					$last_svg_point = explode( ',', (string) end( $svg_points ) );
					?>
					<div class="halo-assist-route" aria-label="Recent route trace"><svg viewBox="0 0 600 220" role="img" aria-label="Self-contained recent route trace"><path class="halo-assist-route-grid" d="M20 20H580M20 80H580M20 140H580M20 200H580M20 20V200M160 20V200M300 20V200M440 20V200M580 20V200"></path><polyline points="<?php echo esc_attr( implode( ' ', $svg_points ) ); ?>"></polyline><circle cx="<?php echo esc_attr( (string) ( $last_svg_point[0] ?? '' ) ); ?>" cy="<?php echo esc_attr( (string) ( $last_svg_point[1] ?? '' ) ); ?>" r="7"></circle></svg><small>Recent on-device trace. This diagram is self-contained and does not contact a map-tile service.</small></div>
				<?php endif; ?>
			</section>

			<?php if ( ! $is_test ) :
				$media_endpoint = add_query_arg(
					'role',
					(string) $halo_emergency['role'],
					rest_url( 'avenra-halo/v2/responders/incidents/' . rawurlencode( (string) $incident->public_id ) . '/media' )
				);
				?>
				<section class="halo-assist-card halo-assist-media" data-incident-media>
					<p class="halo-assist-kicker">RIDER INCIDENT VIDEO · AUDIO OFF</p>
					<h2>Protected front and rear views</h2>
					<p class="halo-assist-muted">If the rider opted in, Halo sends only the final rolling clips after this incident activates. Video is supporting context only: never delay calling 999 or the rider while waiting for it.</p>
					<p class="halo-assist-media-status" data-incident-media-status role="status" aria-live="polite">Checking for protected rider footage…</p>
					<div class="halo-assist-media-grid" data-incident-media-grid></div>
					<noscript><p class="halo-assist-alert halo-assist-alert--error">JavaScript is required to load protected incident video.</p></noscript>
				</section>
				<script nonce="<?php echo esc_attr( (string) ( $halo_emergency['csp_nonce'] ?? '' ) ); ?>">
				(() => {
					'use strict';
					const endpoint = new URL(<?php echo wp_json_encode( esc_url_raw( $media_endpoint ) ); ?>, window.location.origin);
					const status = document.querySelector('[data-incident-media-status]');
					const grid = document.querySelector('[data-incident-media-grid]');
					let attempts = 0;
					let signature = '';
					let timer = 0;
					const safeUrl = value => {
						const url = new URL(String(value || ''), window.location.origin);
						return url.origin === window.location.origin ? url.href : '';
					};
					const render = items => {
						const nextSignature = items.map(item => `${item.id}:${item.camera_role}:${item.segment_index}`).join('|');
						if (nextSignature === signature) return;
						signature = nextSignature;
						grid.replaceChildren();
						items.forEach(item => {
							const streamUrl = safeUrl(item.stream_url);
							const downloadUrl = safeUrl(item.download_url);
							if (!streamUrl || !downloadUrl) return;
							const card = document.createElement('article');
							card.className = 'halo-assist-media-clip';
							const title = document.createElement('h3');
							title.textContent = `${item.camera_role === 'front' ? 'Front-facing' : 'Rear-facing'} · clip ${Number(item.segment_index) + 1}`;
							const video = document.createElement('video');
							video.controls = true;
							video.playsInline = true;
							video.preload = 'metadata';
							video.src = streamUrl;
							const meta = document.createElement('small');
							meta.textContent = `${Math.max(0, Math.round(Number(item.duration_ms) / 1000))} sec · audio off`;
							const download = document.createElement('a');
							download.className = 'halo-assist-button halo-assist-button--light';
							download.href = downloadUrl;
							download.textContent = 'Download protected clip';
							download.referrerPolicy = 'no-referrer';
							card.append(title, video, meta, download);
							grid.append(card);
						});
					};
					const check = () => {
						timer = 0;
						attempts += 1;
						fetch(endpoint.href, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
							.then(response => response.ok ? response.json() : Promise.reject(new Error('unavailable')))
							.then(payload => {
								const data = payload && payload.ok === true ? payload.data : payload;
								const items = Array.isArray(data && data.items) ? data.items : [];
								render(items);
								status.textContent = items.length
									? `${items.length} protected clip${items.length === 1 ? '' : 's'} received. More may arrive while the rider remains connected.`
									: 'No incident video has arrived. Halo will keep checking briefly; continue emergency actions now.';
							})
							.catch(() => { status.textContent = 'Protected incident video is not available yet. Continue emergency actions now.'; })
							.finally(() => {
								if (attempts < 24 && !document.hidden) timer = window.setTimeout(check, 5000);
							});
					};
					document.addEventListener('visibilitychange', () => {
						if (!document.hidden && attempts < 24 && !timer) check();
					});
					check();
				})();
				</script>
			<?php endif; ?>

			<div class="halo-assist-grid">
				<section class="halo-assist-card">
					<p class="halo-assist-kicker">IMPACT & ORIENTATION</p>
					<dl class="halo-assist-facts">
						<div><dt>Speed</dt><dd><?php echo esc_html( isset( $impact['speed_mph'] ) ? round( (float) $impact['speed_mph'], 1 ) . ' mph' : 'Unavailable' ); ?></dd></div>
						<div><dt>Speed immediately before</dt><dd><?php echo esc_html( isset( $impact['prior_speed_mph'] ) ? round( (float) $impact['prior_speed_mph'], 1 ) . ' mph' : 'Unavailable' ); ?></dd></div>
						<div><dt>Recent top speed</dt><dd><?php echo esc_html( isset( $impact['top_speed_mph'] ) ? round( (float) $impact['top_speed_mph'], 1 ) . ' mph' : 'Unavailable' ); ?></dd></div>
						<div><dt>Peak force</dt><dd><?php echo esc_html( isset( $impact['peak_g_force'] ) ? round( (float) $impact['peak_g_force'], 2 ) . ' g' : 'Unavailable' ); ?></dd></div>
						<div><dt>Axes X / Y / Z</dt><dd><?php $axes = is_array( $impact['axes'] ?? null ) ? $impact['axes'] : array(); echo esc_html( implode( ' / ', array_map( static fn( $v ) => null === $v ? '—' : (string) round( (float) $v, 2 ), array( $axes['x'] ?? null, $axes['y'] ?? null, $axes['z'] ?? null ) ) ) ); ?></dd></div>
						<div><dt>Gravity X / Y / Z</dt><dd><?php $gravity = is_array( $impact['gravity'] ?? null ) ? $impact['gravity'] : array(); echo esc_html( implode( ' / ', array_map( static fn( $v ) => null === $v ? '—' : (string) round( (float) $v, 2 ), array( $gravity['x'] ?? null, $gravity['y'] ?? null, $gravity['z'] ?? null ) ) ) ); ?></dd></div>
						<div><dt>Lean</dt><dd><?php echo esc_html( isset( $impact['lean_degrees'] ) ? round( (float) $impact['lean_degrees'], 1 ) . '°' : 'Unavailable' ); ?></dd></div>
						<div><dt>Maximum lean L / R</dt><dd><?php echo esc_html( ( isset( $impact['max_lean_left'] ) ? round( (float) $impact['max_lean_left'], 1 ) . '°' : '—' ) . ' / ' . ( isset( $impact['max_lean_right'] ) ? round( (float) $impact['max_lean_right'], 1 ) . '°' : '—' ) ); ?></dd></div>
						<div><dt>Sensor source</dt><dd><?php echo esc_html( (string) ( $impact['source'] ?? 'Unavailable' ) ); ?></dd></div>
						<div><dt>Estimated orientation</dt><dd><?php echo esc_html( (string) ( $impact['estimated_orientation'] ?? 'Unavailable' ) ); ?></dd></div>
						<div><dt>Movement</dt><dd><?php echo esc_html( (string) ( $impact['movement'] ?? $location['movement'] ?? 'Unavailable' ) ); ?></dd></div>
					</dl>
					<?php $severity = is_array( $impact['severity'] ?? null ) ? $impact['severity'] : array(); if ( $severity ) : ?><p class="halo-assist-muted"><strong>Telemetry priority: <?php echo esc_html( ucwords( str_replace( '_', ' ', (string) ( $severity['tier'] ?? 'unclassified' ) ) ) ); ?>.</strong> <?php echo esc_html( (string) ( $severity['method'] ?? 'Telemetry triage only; not an injury assessment.' ) ); ?> Thresholds: elevated 3g/15mph, high 5g/30mph, critical 8g/45mph.</p><?php endif; ?>
				</section>

				<section class="halo-assist-card">
					<p class="halo-assist-kicker">DEVICE & NETWORK</p>
					<dl class="halo-assist-facts">
						<div><dt>Battery</dt><dd><?php echo esc_html( (string) ( $device['battery'] ?? 'Unavailable' ) ); ?></dd></div>
						<?php $phone_battery = is_array( $device['phone_battery'] ?? null ) ? $device['phone_battery'] : array(); ?>
						<div><dt>Phone battery</dt><dd><?php echo esc_html( isset( $phone_battery['level_percent'] ) ? round( (float) $phone_battery['level_percent'] ) . '%' . ( ! empty( $phone_battery['charging'] ) ? ' · charging' : '' ) : 'Unavailable' ); ?></dd></div>
						<div><dt>Device</dt><dd><?php echo esc_html( trim( (string) ( $device['platform'] ?? '' ) . ' ' . (string) ( $device['model'] ?? '' ) ) ?: 'Unavailable' ); ?></dd></div>
						<div><dt>Screen state</dt><dd><?php echo esc_html( trim( (string) ( $device['visibility'] ?? '' ) . ' ' . (string) ( $device['screen_orientation'] ?? '' ) ) ?: 'Unavailable' ); ?></dd></div>
						<div><dt>Network</dt><dd><?php echo esc_html( trim( (string) ( $network['connection_type'] ?? '' ) . ' ' . (string) ( $network['effective_type'] ?? '' ) ) ?: 'Unavailable' ); ?></dd></div>
						<div><dt>Link estimate</dt><dd><?php echo esc_html( ( isset( $network['downlink_mbps'] ) ? round( (float) $network['downlink_mbps'], 1 ) . ' Mbps' : '—' ) . ' / ' . ( isset( $network['rtt_ms'] ) ? round( (float) $network['rtt_ms'] ) . ' ms RTT' : '—' ) ); ?></dd></div>
						<div><dt>Data saver</dt><dd><?php echo ! empty( $network['save_data'] ) ? 'On' : 'Off / unknown'; ?></dd></div>
						<div><dt>Online at capture</dt><dd><?php echo ! empty( $network['online'] ) ? 'Yes' : 'No / unknown'; ?></dd></div>
					</dl>
				</section>
			</div>

			<?php if ( $medical ) : ?>
				<section class="halo-assist-card halo-assist-card--medical">
					<p class="halo-assist-kicker">CONSENTED MEDICAL INFORMATION</p>
					<dl class="halo-assist-facts halo-assist-facts--wide"><div><dt>Date of birth</dt><dd><?php echo esc_html( (string) ( $medical['date_of_birth'] ?? 'Not supplied' ) ); ?></dd></div><div><dt>Blood type</dt><dd><?php echo esc_html( (string) ( $medical['blood_type'] ?? 'Not supplied' ) ); ?></dd></div><div><dt>Weight</dt><dd><?php echo esc_html( isset( $medical['weight_kg'] ) ? $medical['weight_kg'] . ' kg' : 'Not supplied' ); ?></dd></div></dl>
					<?php if ( ! empty( $medical['notes'] ) ) : ?><p class="halo-assist-medical-notes"><?php echo nl2br( esc_html( (string) $medical['notes'] ) ); ?></p><?php endif; ?>
				</section>
			<?php endif; ?>

			<?php if ( $telemetry ) : ?>
				<section class="halo-assist-card"><p class="halo-assist-kicker">RECENT TELEMETRY</p><div class="halo-assist-table-wrap"><table><thead><tr><th>Time</th><th>Speed</th><th>G-force</th><th>Heading</th></tr></thead><tbody><?php foreach ( $telemetry as $sample ) : if ( ! is_array( $sample ) ) continue; ?><tr><td><?php echo esc_html( (string) ( $sample['at'] ?? $sample['time'] ?? '—' ) ); ?></td><td><?php echo esc_html( (string) ( $sample['speed_mph'] ?? $sample['speed'] ?? '—' ) ); ?></td><td><?php echo esc_html( (string) ( $sample['g_force'] ?? $sample['g'] ?? '—' ) ); ?></td><td><?php echo esc_html( (string) ( $sample['heading'] ?? '—' ) ); ?></td></tr><?php endforeach; ?></tbody></table></div></section>
			<?php endif; ?>

			<?php if ( $authoritative && ! $terminal ) : ?>
				<section class="halo-assist-card halo-assist-actions">
					<p class="halo-assist-kicker"><?php echo $is_test ? 'CONTROLLED TEST' : 'HUMAN RESPONSE ACTIONS'; ?></p><h2><?php echo $is_test ? 'Finish this exercise safely' : 'Record each action as it happens'; ?></h2>
					<div class="halo-assist-action-grid">
						<?php if ( $is_test ) : ?>
							<form method="post" action="<?php echo esc_url( $dashboard_url ); ?>"><input type="hidden" name="emergency_action" value="test_complete"><input type="hidden" name="emergency_csrf" value="<?php echo esc_attr( $csrf ); ?>"><button type="submit" class="halo-assist-button halo-assist-button--dark">Complete test — no real-world action</button></form>
						<?php else : ?>
							<a class="halo-assist-button halo-assist-button--danger" href="tel:999">Call 999 now</a>
							<?php foreach ( array(
							'rider_no_answer'          => 'Record rider: no answer',
							'rider_confirmed'          => 'Record rider: accident confirmed',
							'false_alarm'              => 'Resolve as false alarm',
							'emergency_services_called'=> 'Record that I called 999',
							'alert_next_of_kin'        => 'Alert next of kin after 999',
							'handover_complete'        => 'Complete handover & resolve',
						) as $action => $label ) : ?>
							<form method="post" action="<?php echo esc_url( $dashboard_url ); ?>"><input type="hidden" name="emergency_action" value="<?php echo esc_attr( $action ); ?>"><input type="hidden" name="emergency_csrf" value="<?php echo esc_attr( $csrf ); ?>"><button type="submit" class="halo-assist-button <?php echo in_array( $action, array( 'false_alarm', 'handover_complete' ), true ) ? 'halo-assist-button--light' : 'halo-assist-button--dark'; ?>"<?php echo in_array( $action, array( 'alert_next_of_kin', 'handover_complete' ), true ) && null === $incident->emergency_services_called_at ? ' disabled' : ''; ?>><?php echo esc_html( $label ); ?></button></form>
							<?php endforeach; ?>
						<?php endif; ?>
					</div>
					<p class="halo-assist-muted"><?php echo $is_test ? 'Completing a test closes only this drill record. It never contacts emergency services or next of kin.' : '“Record that I called 999” records a human action only. Halo does not place emergency calls.'; ?></p>
				</section>
			<?php endif; ?>

			<section class="halo-assist-card halo-assist-timeline">
				<p class="halo-assist-kicker">AUDIT TIMELINE</p><h2>Incident activity</h2>
				<ol><?php foreach ( array_reverse( $events ) as $event ) : ?><li><span></span><div><strong><?php echo esc_html( $event_labels[ $event['event_type'] ] ?? ucwords( str_replace( '_', ' ', (string) $event['event_type'] ) ) ); ?></strong><small><?php echo esc_html( wp_date( 'j M Y, H:i:s', strtotime( (string) $event['created_at'] . ' UTC' ) ?: time() ) ); ?> · <?php echo esc_html( ucwords( str_replace( '_', ' ', (string) $event['actor_role'] ) ) ); ?> device/system attribution</small></div></li><?php endforeach; ?></ol>
			</section>

		<?php else : ?>
			<section class="halo-assist-centre"><p class="halo-assist-kicker">SECURE INCIDENT ACCESS</p><h1>Link unavailable</h1><p class="halo-assist-muted"><?php echo esc_html( (string) ( $halo_emergency['message'] ?? 'This private Emergency Assist link is unavailable or has expired.' ) ); ?></p></section>
		<?php endif; ?>
	</main>
</body>
</html>
