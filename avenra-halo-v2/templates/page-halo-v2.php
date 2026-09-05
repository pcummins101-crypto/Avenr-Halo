<?php
/**
 * Minimal, plugin-owned page frame for the Halo V2 application.
 *
 * This template is selected only for the page created and marked by the
 * plugin. It deliberately omits theme chrome while retaining the standard
 * WordPress head, body-open and footer hooks required by integrations.
 *
 * @package Avenra_Halo_V2
 */

defined( 'ABSPATH' ) || exit;
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<?php wp_head(); ?>
</head>
<body <?php body_class( 'avenra-halo-v2-page' ); ?>>
	<?php wp_body_open(); ?>
	<?php echo do_shortcode( '[avenra_halo_v2]' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
	<?php wp_footer(); ?>
</body>
</html>
