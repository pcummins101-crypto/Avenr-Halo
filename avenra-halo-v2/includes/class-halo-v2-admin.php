<?php

defined( 'ABSPATH' ) || exit;

/** Administrator-only customer access recovery. */
final class Avenra_Halo_V2_Admin {
	private const PAGE_SLUG = 'avenra-halo-v2-access';
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

		add_action( 'admin_menu', array( $this, 'register_page' ) );
		add_action( 'admin_post_avenra_halo_v2_reset_customer_pin', array( $this, 'handle_pin_reset' ) );
	}

	public function register_page(): void {
		add_management_page(
			__( 'Halo Customer Access', 'avenra-halo-v2' ),
			__( 'Halo Customer Access', 'avenra-halo-v2' ),
			$this->capability(),
			self::PAGE_SLUG,
			array( $this, 'render_page' )
		);
	}

	public function render_page(): void {
		if ( ! current_user_can( $this->capability() ) ) {
			wp_die( esc_html__( 'You are not allowed to manage Halo customer access.', 'avenra-halo-v2' ), '', array( 'response' => 403 ) );
		}

		$status    = isset( $_GET['halo_result'] ) ? sanitize_key( wp_unslash( $_GET['halo_result'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only result code.
		$emergency = Avenra_Halo_V2_Emergency::instance()->provider_status();
		$notices = array(
			'success'            => array( 'success', __( 'The Halo PIN was reset. Existing Halo V2 sessions and live-location links for that customer were ended.', 'avenra-halo-v2' ) ),
			'invalid'            => array( 'error', __( 'Enter a valid customer email and matching six-digit PINs.', 'avenra-halo-v2' ) ),
			'customer-not-found' => array( 'error', __( 'No Halo customer matched that email address.', 'avenra-halo-v2' ) ),
			'busy'               => array( 'warning', __( 'Halo is securing that account. Wait a moment and try again.', 'avenra-halo-v2' ) ),
			'failed'             => array( 'error', __( 'Halo could not safely reset that customer PIN. No insecure fallback was enabled.', 'avenra-halo-v2' ) ),
		);
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Halo Customer Access', 'avenra-halo-v2' ); ?></h1>
			<?php if ( isset( $notices[ $status ] ) ) : ?>
				<div class="notice notice-<?php echo esc_attr( $notices[ $status ][0] ); ?> is-dismissible"><p><?php echo esc_html( $notices[ $status ][1] ); ?></p></div>
			<?php endif; ?>
			<p><?php esc_html_e( 'Use this support tool when a customer exists but their stored Halo credential needs to be replaced. The new PIN is securely hashed, legacy plaintext is removed, and existing Halo V2 sessions are revoked.', 'avenra-halo-v2' ); ?></p>
			<h2><?php esc_html_e( 'Emergency Assist readiness', 'avenra-halo-v2' ); ?></h2>
			<div class="notice notice-<?php echo ! empty( $emergency['ready'] ) ? 'success' : 'error'; ?> inline">
				<p><strong><?php echo ! empty( $emergency['ready'] ) ? esc_html__( 'Responder alerting is configured.', 'avenra-halo-v2' ) : esc_html__( 'Responder alerting is not ready.', 'avenra-halo-v2' ); ?></strong></p>
				<p><?php
					echo esc_html(
						sprintf(
							/* translators: 1: SMS adapter, 2: primary last four digits, 3: backup last four digits, 4: scheduler. */
							__( 'SMS adapter: %1$s · primary ending %2$s · backup ending %3$s · scheduler: %4$s.', 'avenra-halo-v2' ),
							(string) ( $emergency['sms_adapter'] ?? 'unavailable' ),
							(string) ( $emergency['primary_last_four'] ?? '—' ),
							(string) ( $emergency['backup_last_four'] ?? '—' ),
							! empty( $emergency['action_scheduler'] ) ? 'Action Scheduler' : 'WP-Cron/request-time fallback'
						)
					);
				?></p>
				<?php if ( empty( $emergency['ready'] ) ) : ?><p><?php esc_html_e( 'Configure the server-only FireText key (or the Emergency Assist SMS delivery filter) and verify encryption support before enabling riders.', 'avenra-halo-v2' ); ?></p><?php endif; ?>
				<p><?php esc_html_e( 'The 15-second backup is best effort unless the site runs a continuously executing external queue worker.', 'avenra-halo-v2' ); ?></p>
			</div>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" autocomplete="off">
				<input type="hidden" name="action" value="avenra_halo_v2_reset_customer_pin">
				<?php wp_nonce_field( 'avenra_halo_v2_reset_customer_pin' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="avenra-halo-v2-customer-email"><?php esc_html_e( 'Customer email', 'avenra-halo-v2' ); ?></label></th>
						<td><input id="avenra-halo-v2-customer-email" class="regular-text" type="email" name="customer_email" autocomplete="off" required></td>
					</tr>
					<tr>
						<th scope="row"><label for="avenra-halo-v2-new-pin"><?php esc_html_e( 'New six-digit PIN', 'avenra-halo-v2' ); ?></label></th>
						<td><input id="avenra-halo-v2-new-pin" class="regular-text" type="password" name="new_pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required></td>
					</tr>
					<tr>
						<th scope="row"><label for="avenra-halo-v2-confirm-pin"><?php esc_html_e( 'Confirm PIN', 'avenra-halo-v2' ); ?></label></th>
						<td><input id="avenra-halo-v2-confirm-pin" class="regular-text" type="password" name="confirm_pin" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="new-password" required></td>
					</tr>
				</table>
				<?php submit_button( __( 'Reset Halo PIN', 'avenra-halo-v2' ) ); ?>
			</form>
		</div>
		<?php
	}

	public function handle_pin_reset(): void {
		$request_method = isset( $_SERVER['REQUEST_METHOD'] ) ? strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ) ) ) : '';
		if ( 'POST' !== $request_method ) {
			wp_die( esc_html__( 'Halo customer access changes require a POST request.', 'avenra-halo-v2' ), '', array( 'response' => 405 ) );
		}
		if ( ! current_user_can( $this->capability() ) ) {
			wp_die( esc_html__( 'You are not allowed to manage Halo customer access.', 'avenra-halo-v2' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( 'avenra_halo_v2_reset_customer_pin' );

		$email   = isset( $_POST['customer_email'] ) && is_string( $_POST['customer_email'] ) ? strtolower( trim( sanitize_email( wp_unslash( $_POST['customer_email'] ) ) ) ) : '';
		$pin     = isset( $_POST['new_pin'] ) && is_string( $_POST['new_pin'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['new_pin'] ) ) ) : '';
		$confirm = isset( $_POST['confirm_pin'] ) && is_string( $_POST['confirm_pin'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['confirm_pin'] ) ) ) : '';

		if ( ! is_email( $email ) || ! preg_match( '/^\d{6}$/', $pin ) || ! hash_equals( $pin, $confirm ) ) {
			$this->redirect( 'invalid' );
		}

		$customer = Avenra_Halo_V2_Database::instance()->customer_by_email( $email );
		if ( ! $customer ) {
			$this->redirect( 'customer-not-found' );
		}

		$result = Avenra_Halo_V2_Auth::instance()->administrator_reset_customer_pin( (int) $customer->id, $pin );
		if ( is_wp_error( $result ) ) {
			$this->redirect( 'pin_reset_busy' === $result->get_error_code() ? 'busy' : 'failed' );
		}

		$this->redirect( 'success' );
	}

	private function capability(): string {
		$capability = sanitize_key( (string) apply_filters( 'avenra_halo_v2_admin_capability', 'manage_options' ) );
		return '' !== $capability ? $capability : 'manage_options';
	}

	private function redirect( string $result ): void {
		wp_safe_redirect( add_query_arg( 'halo_result', sanitize_key( $result ), admin_url( 'tools.php?page=' . self::PAGE_SLUG ) ) );
		exit;
	}
}
