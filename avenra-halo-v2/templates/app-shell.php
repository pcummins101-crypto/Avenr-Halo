<?php
/**
 * Avenra Halo v2 application shell.
 *
 * The plugin controller is responsible for enqueueing the compiled assets and
 * localising window.AvenraHaloV2Config before this template is included.
 *
 * @package Avenra_Halo_V2
 */

defined( 'ABSPATH' ) || exit;

$halo_v2_logo_white = esc_url( (string) ( $halo_v2_config['brandLogoWhite'] ?? AVENRA_HALO_V2_LOGO_WHITE ) );
$halo_v2_logo_black = esc_url( (string) ( $halo_v2_config['brandLogoBlack'] ?? AVENRA_HALO_V2_LOGO_BLACK ) );
$halo_v2_profile_mark_default = esc_url( (string) ( $halo_v2_config['profileMarks']['default'] ?? AVENRA_HALO_V2_PROFILE_MARK_DEFAULT ) );
?>

<div id="avenra-halo-v2" class="halo-app" data-app-state="booting" aria-busy="true">
	<a class="halo-skip-link" href="#halo-main">Skip to content</a>

	<svg class="halo-icon-library" aria-hidden="true" focusable="false">
		<symbol id="halo-icon-home" viewBox="0 0 24 24"><path d="M3.5 10.8 12 3.7l8.5 7.1v9.4h-6v-5.8h-5v5.8h-6z"/></symbol>
		<symbol id="halo-icon-bike" viewBox="0 0 24 24"><path d="M6.2 18.8a3.7 3.7 0 1 1 0-7.4 3.7 3.7 0 0 1 0 7.4Zm11.6 0a3.7 3.7 0 1 1 0-7.4 3.7 3.7 0 0 1 0 7.4ZM6.2 15.1h4.3l3.2-5.8h3.1m-7.4 1.8-1.3-3H5.8m6.8 7h5.2l-3.1-5.8H10"/></symbol>
		<symbol id="halo-icon-route" viewBox="0 0 24 24"><path d="M6.2 20.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm11.6-10.6a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM8.9 17.3h2.4c4.3 0 6.5-1.8 6.5-5.4v-2"/></symbol>
		<symbol id="halo-icon-activity" viewBox="0 0 24 24"><path d="M4 18.8V12m5.3 6.8V6.5m5.4 12.3V9.3m5.3 9.5V3.9"/></symbol>
		<symbol id="halo-icon-more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></symbol>
		<symbol id="halo-icon-lock" viewBox="0 0 24 24"><rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10m-4 4v2.8"/></symbol>
		<symbol id="halo-icon-battery" viewBox="0 0 24 24"><rect x="2.7" y="6.3" width="17.3" height="11.4" rx="2.2"/><path d="M22 10v4M6 10h7.5m-3.8-3v6"/></symbol>
		<symbol id="halo-icon-pin" viewBox="0 0 24 24"><path d="M12 21s6-6.6 6-11.7a6 6 0 1 0-12 0C6 14.4 12 21 12 21Z"/><circle cx="12" cy="9.3" r="2.2"/></symbol>
		<symbol id="halo-icon-chevron" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></symbol>
		<symbol id="halo-icon-shield" viewBox="0 0 24 24"><path d="M12 21s8-3.7 8-10.3V5l-8-2.5L4 5v5.7C4 17.3 12 21 12 21Z"/><path d="m8.4 11.8 2.3 2.2 4.8-5"/></symbol>
		<symbol id="halo-icon-document" viewBox="0 0 24 24"><path d="M6 2.7h8l4 4V21H6z"/><path d="M14 2.7V7h4M9 12h6m-6 3.5h6"/></symbol>
		<symbol id="halo-icon-book" viewBox="0 0 24 24"><path d="M4 4.3h5.3c1.5 0 2.7 1.2 2.7 2.7v13c0-1.5-1.2-2.7-2.7-2.7H4zm16 0h-5.3C13.2 4.3 12 5.5 12 7v13c0-1.5 1.2-2.7 2.7-2.7H20z"/></symbol>
		<symbol id="halo-icon-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.5-4.3 3-6.5 7.5-6.5s7 2.2 7.5 6.5"/></symbol>
		<symbol id="halo-icon-community" viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M2.7 20c.4-4.1 2.2-6.1 5.3-6.1s5 2 5.4 6.1m.2-5.1c.8-.7 1.8-1 3-1 2.8 0 4.3 1.7 4.7 5.2"/></symbol>
		<symbol id="halo-icon-chat" viewBox="0 0 24 24"><path d="M4 4.5h16v11H9l-5 4z"/><path d="M8 9h8m-8 3h5"/></symbol>
		<symbol id="halo-icon-send" viewBox="0 0 24 24"><path d="m3 4 18 8-18 8 3-8zM6 12h15"/></symbol>
		<symbol id="halo-icon-flag" viewBox="0 0 24 24"><path d="M5 21V3m0 1h11l-2 4 2 4H5"/></symbol>
		<symbol id="halo-icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
		<symbol id="halo-icon-heart" viewBox="0 0 24 24"><path d="M20.7 5.8c-2.3-2.4-6-1.9-8.7 1.1-2.7-3-6.4-3.5-8.7-1.1-2.4 2.5-1.6 6.7.7 9L12 22l8-7.2c2.3-2.3 3.1-6.5.7-9Z"/></symbol>
		<symbol id="halo-icon-bag" viewBox="0 0 24 24"><path d="M4.5 8.5h15l-1 12h-13zM8.5 9V6.5a3.5 3.5 0 0 1 7 0V9"/></symbol>
		<symbol id="halo-icon-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a8 8 0 0 0 .1-5.7l2-1.6-2-3.4-2.5 1a8.2 8.2 0 0 0-4.9-2.8L11.7 0H7.8l-.4 2.6a8.2 8.2 0 0 0-4.9 2.8L0 4.3l-2 3.4 2 1.6A8 8 0 0 0 .1 15l-2.1 1.6 2 3.4 2.5-1a8.2 8.2 0 0 0 4.9 2.8l.4 2.6h3.9l.4-2.6A8.2 8.2 0 0 0 17 19l2.5 1 2-3.4z" transform="translate(2.2 -.2) scale(.82)"/></symbol>
		<symbol id="halo-icon-service" viewBox="0 0 24 24"><path d="m14.6 6.4 3-3a4.4 4.4 0 0 1-5.8 5.8L5 16a2.1 2.1 0 1 0 3 3l6.8-6.8a4.4 4.4 0 0 0 5.8-5.8l-3 3"/></symbol>
		<symbol id="halo-icon-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/></symbol>
		<symbol id="halo-icon-close" viewBox="0 0 24 24"><path d="m5 5 14 14M19 5 5 19"/></symbol>
		<symbol id="halo-icon-arrow" viewBox="0 0 24 24"><path d="m5 12 6-6m-6 6 6 6M5 12h14"/></symbol>
		<symbol id="halo-icon-warning" viewBox="0 0 24 24"><path d="M12 3 2.5 20h19zM12 9v5m0 3v.2"/></symbol>
		<symbol id="halo-icon-camera" viewBox="0 0 24 24"><path d="M3 7.5h4l1.5-2h7l1.5 2h4v12H3z"/><circle cx="12" cy="13.5" r="3.5"/></symbol>
		<symbol id="halo-icon-upload" viewBox="0 0 24 24"><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/></symbol>
		<symbol id="halo-icon-check" viewBox="0 0 24 24"><path d="m4 12.5 5 5L20 6.5"/></symbol>
		<symbol id="halo-icon-fingerprint" viewBox="0 0 24 24"><path d="M5.5 10a6.5 6.5 0 0 1 13 0v2m-10-2a3.5 3.5 0 0 1 7 0v2.7c0 3.3-1.4 6.2-3.5 8m-6.5-7.8V10m3 3v1.2c0 2.4-.7 4.7-2 6.5m5-10.7v3c0 2-.5 3.9-1.4 5.6M18.5 16v-6"/></symbol>
		<symbol id="halo-icon-bluetooth" viewBox="0 0 24 24"><path d="m6.5 7 11 10-5.5 4V3l5.5 4-11 10"/></symbol>
	</svg>

	<div id="halo-connectivity" class="halo-system-banner" role="status" hidden>
		<svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-warning"></use></svg>
		<span data-connectivity-message>You are offline. Saved information remains available.</span>
		<button type="button" class="halo-text-button" data-action="retry-bootstrap">Try again</button>
	</div>

	<aside id="halo-guardian-sharing" class="halo-guardian-sharing" aria-label="Halo Guardian location sharing" hidden>
		<span class="halo-guardian-sharing__icon" aria-hidden="true"><svg class="halo-icon"><use href="#halo-icon-shield"></use></svg></span>
		<span class="halo-guardian-sharing__copy"><strong>Guardian location active</strong><small data-guardian-sharing-status role="status" aria-live="polite">Finding a precise GPS position…</small></span>
		<button type="button" class="halo-button halo-button--light" data-action="stop-guardian-resume">Stop</button>
	</aside>

	<section id="halo-boot" class="halo-boot" aria-label="Loading Avenrà Halo">
		<img class="halo-brand-logo halo-brand-logo--boot halo-brand-logo--light" alt="Avenrà Halo" src="<?php echo esc_url( $halo_v2_logo_white ); ?>" width="815" height="303" decoding="async" fetchpriority="high">
		<div class="halo-boot-mark" aria-hidden="true"></div>
		<p>Preparing Halo</p>
	</section>

	<section id="halo-auth" class="halo-auth" aria-labelledby="halo-auth-title" hidden>
		<div class="halo-auth-panel">
			<header class="halo-auth-header">
				<img class="halo-brand-logo halo-brand-logo--auth halo-brand-logo--dark" alt="Avenrà Halo" src="<?php echo esc_url( $halo_v2_logo_black ); ?>" width="815" height="303" decoding="async">
				<h1 id="halo-auth-title">Welcome back</h1>
				<p id="halo-auth-description">Sign in to your motorcycle and journeys.</p>
			</header>

			<nav class="halo-segmented" aria-label="Account access">
				<button type="button" class="is-active" data-auth-view="login" aria-pressed="true">Sign in</button>
				<button type="button" data-auth-view="signup" aria-pressed="false">Create account</button>
			</nav>

			<div id="halo-auth-alert" class="halo-inline-alert" role="alert" hidden></div>

			<form id="halo-login-form" class="halo-auth-form" data-auth-form="login" method="post" novalidate>
				<label class="halo-field">
					<span>Email address</span>
					<input type="email" name="email" autocomplete="email" inputmode="email" required>
				</label>
				<label class="halo-field">
					<span>Six-digit PIN</span>
					<input type="password" name="pin" autocomplete="current-password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" data-pin-input required>
				</label>
				<button type="submit" class="halo-button halo-button--primary" data-submit-label="Sign in">Sign in</button>
				<button type="button" class="halo-button halo-button--quiet halo-passkey-button" data-action="passkey-login" hidden>
					<svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-fingerprint"></use></svg>
					Use fingerprint, face or passkey
				</button>
				<button type="button" class="halo-text-button halo-centered" data-auth-view="recovery">Forgotten your PIN?</button>
				<button type="button" class="halo-text-button halo-centered" data-action="reset-device-session" data-reset-device-session hidden>Reset this device session</button>
			</form>

			<form id="halo-signup-form" class="halo-auth-form" data-auth-form="signup" method="post" hidden novalidate>
				<div class="halo-field-row">
					<label class="halo-field"><span>Full name</span><input type="text" name="full_name" autocomplete="name" required></label>
					<label class="halo-field"><span>Mobile</span><input type="tel" name="mobile" autocomplete="tel" inputmode="tel" required></label>
				</div>
				<label class="halo-field"><span>Email address</span><input type="email" name="email" autocomplete="email" required></label>
				<label class="halo-field"><span>Home address</span><textarea name="full_address" autocomplete="street-address" rows="2" required></textarea></label>
				<label class="halo-field"><span>Postcode</span><input type="text" name="postcode" autocomplete="postal-code" required></label>
				<label class="halo-field"><span>Date of birth</span><input type="date" name="date_of_birth" autocomplete="bday" required><small>Used to protect your account and correctly identify optional safety information.</small></label>
				<label class="halo-field">
					<span>Create a six-digit PIN</span>
					<input type="password" name="pin" autocomplete="new-password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" data-pin-input required>
					<small>Use six numbers you can remember. Avoid dates of birth.</small>
				</label>
				<label class="halo-field">
					<span>Confirm six-digit PIN</span>
					<input type="password" name="confirm_pin" autocomplete="new-password" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" data-pin-input required>
				</label>
				<div class="halo-verification-step" data-registration-verification hidden>
					<p><strong>Check your email</strong><br><span data-registration-verification-copy>Enter the six-digit verification code to prove this email address is yours.</span></p>
					<label class="halo-field">
						<span>Email verification code</span>
						<input type="text" name="verification_code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6">
					</label>
				</div>
				<label class="halo-field"><span>Motorcycle you ride now <small>(optional)</small></span><input type="text" name="current_bike" autocomplete="off"></label>
				<label class="halo-check"><input type="checkbox" name="terms" value="1" required><span>I agree to the Halo terms and acknowledge the privacy notice.</span></label>
				<button type="submit" class="halo-button halo-button--primary" data-submit-label="Create account">Create account</button>
			</form>

			<form id="halo-recovery-form" class="halo-auth-form" data-auth-form="recovery" method="post" hidden novalidate>
				<button type="button" class="halo-back-button" data-auth-view="login"><svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-arrow"></use></svg> Back</button>
				<h2>Reset your PIN</h2>
				<p>We will send secure reset instructions to your registered email address.</p>
				<label class="halo-field"><span>Email address</span><input type="email" name="email" autocomplete="email" required></label>
				<button type="submit" class="halo-button halo-button--primary" data-submit-label="Send instructions">Send instructions</button>
			</form>

			<aside class="halo-auth-install" data-install-surface aria-label="Install Halo App">
				<button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="install-app" data-install-control>
					<svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-home"></use></svg>
					<span data-install-button-label>Install Halo App</span>
				</button>
				<p data-install-hint>Add Halo to your Home Screen for fast, full-screen access.</p>
			</aside>
		</div>
	</section>

	<div id="halo-product" class="halo-product" hidden>
		<header class="halo-topbar">
			<div class="halo-brand-lockup">
				<img class="halo-brand-logo halo-brand-logo--topbar halo-brand-logo--dark" alt="Avenrà Halo" src="<?php echo esc_url( $halo_v2_logo_black ); ?>" width="815" height="303" decoding="async">
			</div>
			<div class="halo-topbar-actions">
				<button type="button" class="halo-status-pill" data-action="connection-detail" aria-label="Vehicle connection status">
					<span class="halo-status-dot" aria-hidden="true"></span>
					<span data-vehicle-connection>Checking</span>
				</button>
				<button type="button" class="halo-avatar" data-route-target="more/profile" aria-label="Open profile">
					<img class="halo-avatar-logo" src="<?php echo $halo_v2_profile_mark_default; ?>" alt="" width="1536" height="1024" decoding="async" aria-hidden="true" data-profile-mark>
					<span class="halo-sr-only" data-avatar-initials>—</span>
				</button>
			</div>
		</header>

		<main id="halo-main" class="halo-main" tabindex="-1">
			<section class="halo-view is-active" data-route="home" aria-labelledby="halo-home-title">
				<div id="halo-home-content" class="halo-view-content">
					<div class="halo-skeleton halo-skeleton--hero" aria-hidden="true"></div>
					<div class="halo-skeleton-row" aria-hidden="true"><span></span><span></span></div>
					<span class="halo-sr-only">Loading your Halo home screen</span>
				</div>
			</section>

			<section class="halo-view" data-route="vehicle" aria-labelledby="halo-vehicle-title" hidden>
				<header class="halo-page-header">
					<p class="halo-eyebrow">YOUR MOTORCYCLE</p>
					<h1 id="halo-vehicle-title">Vehicle</h1>
				</header>
				<nav class="halo-scroll-tabs" aria-label="Vehicle sections">
					<button type="button" class="is-active" data-vehicle-view="overview">Overview</button>
					<button type="button" data-vehicle-view="battery">HyperCore</button>
					<button type="button" data-vehicle-view="build">Build</button>
					<button type="button" data-vehicle-view="profile">Ride profile</button>
					<button type="button" data-vehicle-view="service">Service</button>
				</nav>
				<div id="halo-vehicle-content" class="halo-view-content"></div>
			</section>

			<section class="halo-view halo-view--ride" data-route="ride" aria-labelledby="halo-ride-title" hidden>
				<header class="halo-page-header halo-page-header--compact">
					<div><p class="halo-eyebrow">NAVIGATION</p><h1 id="halo-ride-title">Plan a ride</h1></div>
					<button type="button" class="halo-icon-button" data-action="recenter-map" aria-label="Centre map on my location"><svg class="halo-icon"><use href="#halo-icon-pin"></use></svg></button>
				</header>
				<form id="halo-route-form" class="halo-route-form">
					<label class="halo-location-field"><span class="halo-route-dot halo-route-dot--start" aria-hidden="true"></span><span class="halo-sr-only">Start</span><input type="text" name="origin" autocomplete="street-address" placeholder="Current location" aria-label="Route start"></label>
					<label class="halo-location-field"><span class="halo-route-dot" aria-hidden="true"></span><span class="halo-sr-only">Destination</span><input type="search" name="destination" autocomplete="off" placeholder="Where are you going?" required aria-label="Destination"></label>
					<div class="halo-preflight-settings">
						<label><span>Ride mode</span><select name="ride_mode" aria-label="Ride mode"><option value="1">Mode 1</option><option value="2" selected>Mode 2</option><option value="3">Mode 3</option></select></label>
						<label><span>Starting charge <output data-start-soc-output>100%</output></span><input type="range" name="start_soc" min="5" max="100" step="1" value="100" aria-label="Starting charge percentage"></label>
					</div>
					<section class="halo-card halo-ride-memory-setup" aria-labelledby="halo-ride-memory-title">
						<div class="halo-toggle-row">
							<div class="halo-toggle-copy"><strong id="halo-ride-memory-title">Record Ride Memories</strong><small>Save this ride's camera footage privately on this device for playback in Halo.</small></div>
							<label class="halo-switch"><input type="checkbox" name="ride_memories_enabled" aria-label="Record Ride Memories for this ride" aria-describedby="halo-ride-memory-help"><span></span></label>
						</div>
						<div class="halo-toggle-row halo-ride-memory-dual" data-ride-memory-dual-setting hidden>
							<div class="halo-toggle-copy"><strong>Include front camera</strong><small>Records front and rear when this phone supports both at once. Rear-only is used safely otherwise.</small></div>
							<label class="halo-switch"><input type="checkbox" name="ride_memories_dual_enabled" aria-label="Include front camera in Ride Memories" disabled><span></span></label>
						</div>
						<p id="halo-ride-memory-help" class="halo-helper">Audio is always off. Footage and its time-synchronised GPS telemetry stay in Halo's private browser storage and are never uploaded automatically. Playback can show estimated speed, ride time and location, with an optional saved or shared copy that leaves the original unchanged. Clearing app/site data removes it all. Keep Halo visible and the screen awake while riding.</p>
						<p class="halo-ride-memory-storage" data-ride-memory-storage role="status" aria-live="polite">Checking available device storage…</p>
					</section>
					<section class="halo-card halo-camera-alignment-setup" aria-labelledby="halo-camera-alignment-title">
						<div class="halo-camera-alignment-setup__copy">
							<span class="halo-camera-alignment-setup__icon" aria-hidden="true"><svg class="halo-icon"><use href="#halo-icon-camera"></use></svg></span>
							<div><strong id="halo-camera-alignment-title">Camera alignment check</strong><small>Preview the complete road-facing and rider-facing frames before setting off.</small></div>
						</div>
						<button type="button" class="halo-button halo-button--secondary halo-full-width" data-action="check-camera-alignment" aria-describedby="halo-camera-alignment-help">Check camera alignment</button>
						<p id="halo-camera-alignment-help" class="halo-helper" data-camera-alignment-setup-status>Live preview only · audio off · nothing is recorded, saved or uploaded.</p>
					</section>
					<button type="button" class="halo-button halo-button--primary halo-route-submit" data-action="plan-route">Find routes</button>
				</form>
				<div id="halo-route-map" class="halo-map" role="application" tabindex="0" aria-label="Route map. Use arrow keys to pan and plus or minus to zoom.">
					<div class="halo-map-state" data-map-state>
						<svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-route"></use></svg>
						<p>Enter a destination to compare routes.</p>
					</div>
				</div>
				<div class="halo-free-ride"><div><strong>Just riding?</strong><small>Record the journey without navigation.</small></div><button type="button" class="halo-button halo-button--secondary" data-action="start-free-ride">Start free ride</button></div>
				<div id="halo-route-results" class="halo-route-results" aria-live="polite"></div>
			</section>

			<section class="halo-view" data-route="activity" aria-labelledby="halo-activity-title" hidden>
				<header class="halo-page-header">
					<p class="halo-eyebrow">JOURNEYS</p>
					<h1 id="halo-activity-title">Activity</h1>
				</header>
				<div id="halo-activity-content" class="halo-view-content"></div>
			</section>

			<section class="halo-view" data-route="more" aria-labelledby="halo-more-title" hidden>
				<header class="halo-page-header"><p class="halo-eyebrow">ACCOUNT & SUPPORT</p><h1 id="halo-more-title">More</h1></header>
				<div id="halo-more-content" class="halo-view-content"></div>
			</section>

			<section class="halo-view halo-detail-view halo-community-view" data-route="more/community" aria-labelledby="halo-community-title" hidden>
				<header class="halo-detail-header"><button type="button" class="halo-back-button" data-route-target="more"><svg class="halo-icon"><use href="#halo-icon-arrow"></use></svg> More</button><h1 id="halo-community-title">Community</h1></header>
				<div id="halo-community-content" class="halo-view-content" aria-live="polite">
					<div class="halo-skeleton halo-community-skeleton" aria-hidden="true"></div>
					<span class="halo-sr-only">Loading Halo Community</span>
				</div>
			</section>

			<section class="halo-view halo-detail-view" data-route="more/safety" aria-labelledby="halo-safety-title" hidden>
				<header class="halo-detail-header"><button type="button" class="halo-back-button" data-route-target="more"><svg class="halo-icon"><use href="#halo-icon-arrow"></use></svg> More</button><h1 id="halo-safety-title">Halo Safety</h1></header>
				<div id="halo-safety-content" class="halo-view-content"></div>
			</section>

			<section class="halo-view halo-detail-view" data-route="more/documents" aria-labelledby="halo-documents-title" hidden>
				<header class="halo-detail-header"><button type="button" class="halo-back-button" data-route-target="more"><svg class="halo-icon"><use href="#halo-icon-arrow"></use></svg> More</button><h1 id="halo-documents-title">Glovebox</h1></header>
				<div id="halo-documents-content" class="halo-view-content"></div>
			</section>

			<section class="halo-view halo-detail-view" data-route="more/manual" aria-labelledby="halo-manual-title" hidden>
				<header class="halo-detail-header"><button type="button" class="halo-back-button" data-route-target="more"><svg class="halo-icon"><use href="#halo-icon-arrow"></use></svg> More</button><h1 id="halo-manual-title">Owner's manual</h1></header>
				<form id="halo-manual-search" class="halo-search-field" role="search"><svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-search"></use></svg><label class="halo-sr-only" for="halo-manual-query">Search owner's manual</label><input id="halo-manual-query" type="search" name="query" placeholder="Search the manual" autocomplete="off"></form>
				<div id="halo-manual-content" class="halo-view-content"></div>
			</section>

			<section class="halo-view halo-detail-view" data-route="more/boutique" aria-labelledby="halo-boutique-title" hidden>
				<header class="halo-detail-header"><button type="button" class="halo-back-button" data-route-target="more"><svg class="halo-icon"><use href="#halo-icon-arrow"></use></svg> More</button><h1 id="halo-boutique-title">Boutique</h1><button type="button" class="halo-cart-button" data-action="open-cart" aria-label="Open basket"><svg class="halo-icon"><use href="#halo-icon-bag"></use></svg><span data-cart-count>0</span></button></header>
				<div id="halo-boutique-content" class="halo-view-content"></div>
			</section>

			<section class="halo-view halo-detail-view" data-route="more/profile" aria-labelledby="halo-profile-title" hidden>
				<header class="halo-detail-header"><button type="button" class="halo-back-button" data-route-target="more"><svg class="halo-icon"><use href="#halo-icon-arrow"></use></svg> More</button><h1 id="halo-profile-title">Profile & security</h1></header>
				<div id="halo-profile-content" class="halo-view-content"></div>
			</section>
		</main>

		<nav class="halo-bottom-nav" aria-label="Primary">
			<button type="button" class="is-active" data-route-target="home" aria-current="page"><svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-home"></use></svg><span>Home</span></button>
			<button type="button" data-route-target="vehicle"><svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-bike"></use></svg><span>Vehicle</span></button>
			<button type="button" class="halo-ride-nav" data-route-target="ride"><span class="halo-ride-nav-icon"><svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-route"></use></svg></span><span>Ride</span></button>
			<button type="button" data-route-target="activity"><svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-activity"></use></svg><span>Activity</span></button>
			<button type="button" data-route-target="more"><svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-more"></use></svg><span>More</span></button>
		</nav>
	</div>

	<section id="halo-active-ride" class="halo-active-ride" aria-labelledby="halo-active-ride-title" tabindex="-1" hidden>
		<header class="halo-ride-guidance">
			<div class="halo-manoeuvre" aria-hidden="true">↑</div>
			<div><p data-next-distance>—</p><h1 id="halo-active-ride-title" data-next-instruction aria-live="polite" aria-atomic="true">Route guidance</h1><div class="halo-ride-focus-status" data-ride-focus-status role="status"><span aria-hidden="true"></span>Ride Focus starting</div></div>
		</header>
		<div class="halo-active-map-wrap">
			<div id="halo-active-map" class="halo-active-map" role="group" aria-label="Live route guidance map"></div>
				<div class="halo-ride-status-stack">
					<div class="halo-ride-degraded" data-ride-degraded role="status" hidden></div>
					<div class="halo-test-ride-status" data-test-ride-monitoring-status role="status" aria-live="polite" hidden>Avenrà test ride monitoring starting…</div>
					<div class="halo-hypercore-ride-status halo-bms-ride-status" data-bms-ride-status role="status" aria-live="polite" hidden>HyperCore data starting…</div>
					<div class="halo-ride-memory-status" data-ride-memory-status role="status" aria-live="polite" hidden>Ride Memories starting · audio off</div>
					<div class="halo-incident-camera-status" data-incident-camera-status role="status" aria-live="polite" hidden>Incident camera starting · audio off</div>
				</div>
			<div class="halo-speed-card" aria-label="Current speed"><strong data-ride-speed>0</strong><span>mph</span></div>
			<div class="halo-active-map-controls" role="group" aria-label="Map view controls">
				<button type="button" data-action="ride-overview" aria-label="Show route overview"><svg class="halo-icon"><use href="#halo-icon-route"></use></svg></button>
				<button type="button" data-action="ride-recenter" aria-label="Following my location" aria-pressed="true" class="is-active"><svg class="halo-icon"><use href="#halo-icon-pin"></use></svg></button>
			</div>
		</div>
		<div class="halo-ride-data-overlay">
			<div class="halo-ride-performance" aria-label="Live ride performance">
				<div><small>Trip</small><strong data-ride-distance>0.0 mi</strong></div>
				<div><small>Time</small><strong data-ride-duration>00:00</strong></div>
				<div><small>Top</small><strong data-ride-top-speed>0 mph</strong></div>
				<div><small>Lean L</small><strong data-ride-lean-left>0°</strong></div>
				<div><small>Lean R</small><strong data-ride-lean-right>0°</strong></div>
				<div><small>Best 0–60</small><strong data-ride-zero-sixty>—</strong></div>
			</div>
			<div class="halo-ride-hud">
				<div><small>Range</small><strong data-ride-range>—</strong></div>
				<div data-ride-bms-field hidden><small>Charge</small><strong data-ride-bms-charge>—</strong></div>
				<div><small>Arrival</small><strong data-ride-arrival>—</strong></div>
				<div><small>GPS</small><strong data-ride-gps>Finding</strong></div>
			</div>
		</div>
		<div class="halo-ride-controls">
			<button type="button" class="halo-ride-control" data-action="report-hazard"><svg class="halo-icon"><use href="#halo-icon-warning"></use></svg><span>Hazard</span></button>
			<button type="button" class="halo-ride-control" data-action="share-live-location"><svg class="halo-icon"><use href="#halo-icon-route"></use></svg><span>Share</span></button>
			<button type="button" class="halo-hold-button" data-action="hold-end-ride" aria-describedby="halo-hold-help"><span data-hold-progress></span><strong>Hold to end</strong></button>
			<p id="halo-hold-help" class="halo-sr-only">Press and hold for two seconds to end this ride.</p>
		</div>
	</section>

	<section id="halo-crash-state" class="halo-crash-state" role="alertdialog" aria-modal="true" aria-labelledby="halo-crash-title" hidden>
		<div class="halo-crash-panel">
			<svg class="halo-icon" aria-hidden="true"><use href="#halo-icon-warning"></use></svg>
			<p class="halo-eyebrow">EMERGENCY ASSIST</p>
			<h1 id="halo-crash-title" data-crash-title>Are you okay?</h1>
			<div class="halo-crash-countdown-view" data-crash-countdown-view>
				<p data-crash-copy>A possible incident was detected. Cancel if you are okay.</p>
				<div class="halo-crash-countdown" data-crash-countdown role="timer" aria-label="Seconds until Emergency Assist">20</div>
				<p class="halo-sr-only" data-crash-announcement aria-live="polite" aria-atomic="true"></p>
				<div class="halo-crash-actions">
					<button type="button" class="halo-button halo-button--light" data-action="cancel-crash">I'm okay — cancel</button>
					<button type="button" class="halo-text-button halo-text-button--light" data-action="send-nok-now">Activate Emergency Assist now</button>
				</div>
				<small data-crash-disclaimer>Emergency Assist does not replace calling 999 when urgent help is needed.</small>
			</div>
			<div class="halo-crash-active" data-crash-active role="status" aria-live="polite" aria-atomic="true" hidden>
				<div class="halo-emergency-status"><span aria-hidden="true"></span><strong>Responder alert accepted</strong></div>
				<p data-emergency-message>A responder alert was accepted. Halo will keep sharing your position while this ride remains active.</p>
				<p class="halo-emergency-detail" data-emergency-status>Status: active.</p>
				<p class="halo-emergency-caveat">Halo has not confirmed that emergency services are attending. Call 999 yourself if urgent help is needed.</p>
				<div class="halo-crash-actions">
					<a class="halo-button halo-button--light" href="tel:999" data-emergency-call>Call 999</a>
					<button type="button" class="halo-text-button halo-text-button--light" data-action="close-emergency-assist">Return to ride</button>
				</div>
			</div>
		</div>
	</section>

	<dialog id="halo-dialog" class="halo-dialog" aria-labelledby="halo-dialog-title">
		<div class="halo-dialog-panel">
			<header><div><p class="halo-eyebrow" data-dialog-eyebrow></p><h2 id="halo-dialog-title" data-dialog-title>Details</h2></div><button type="button" class="halo-icon-button" data-action="close-dialog" aria-label="Close"><span class="halo-close-glyph" aria-hidden="true">&times;</span></button></header>
			<div class="halo-dialog-content" data-dialog-content></div>
		</div>
	</dialog>

	<dialog id="halo-sheet" class="halo-sheet" aria-labelledby="halo-sheet-title">
		<div class="halo-sheet-panel">
			<div class="halo-sheet-handle" aria-hidden="true"></div>
			<header><h2 id="halo-sheet-title" data-sheet-title>Details</h2><button type="button" class="halo-icon-button" data-action="close-sheet" aria-label="Close"><span class="halo-close-glyph" aria-hidden="true">&times;</span></button></header>
			<div class="halo-sheet-content" data-sheet-content></div>
		</div>
	</dialog>

	<div id="halo-toast-region" class="halo-toast-region" aria-live="polite" aria-atomic="true"></div>
</div>
