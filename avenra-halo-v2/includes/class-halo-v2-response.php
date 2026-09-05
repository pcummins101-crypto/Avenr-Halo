<?php

defined( 'ABSPATH' ) || exit;

/**
 * Produces one predictable response envelope across every Halo endpoint.
 */
final class Avenra_Halo_V2_Response {
	private static string $request_id = '';

	public static function request_id(): string {
		if ( '' === self::$request_id ) {
			self::$request_id = wp_generate_uuid4();
		}

		return self::$request_id;
	}

	public static function success( mixed $data = null, int $status = 200, array $meta = array() ): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'ok'         => true,
				'data'       => $data,
				'meta'       => (object) $meta,
				'request_id' => self::request_id(),
			),
			$status
		);
	}

	public static function error( string $code, string $message, int $status = 400, array $details = array() ): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'ok'         => false,
				'error'      => array(
					'code'    => sanitize_key( $code ),
					'message' => $message,
					'details' => (object) $details,
				),
				'request_id' => self::request_id(),
			),
			$status
		);
	}

	/**
	 * Permission callbacks must return true or WP_Error. A rest_post_dispatch
	 * filter converts these errors to the same public envelope as callbacks.
	 */
	public static function permission_error( string $code, string $message, int $status ): WP_Error {
		return new WP_Error( $code, $message, array( 'status' => $status ) );
	}
}

