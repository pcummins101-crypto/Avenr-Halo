<?php

defined( 'ABSPATH' ) || exit;

/**
 * Privacy-first, pseudonymous Halo Community API.
 *
 * Community identity is deliberately isolated from customer, vehicle, ride,
 * location, Emergency Assist and risk data. Public serializers in this class
 * never read those sources and never return an internal customer identifier.
 */
final class Avenra_Halo_V2_Community {
	private const NS = 'avenra-halo/v2';
	private const TERMS_VERSION = '1';
	private const MOD_CAP_VERSION = '1';
	private const ADMIN_SLUG = 'avenra-halo-community-reports';
	public const CAP_MODERATE = 'avenra_halo_community_moderate';

	private static ?self $instance = null;
	private Avenra_Halo_V2_Database $db;
	private Avenra_Halo_V2_Auth $auth;
	private bool $booted = false;

	private function __construct() {
		$this->db = Avenra_Halo_V2_Database::instance();
		$this->auth = Avenra_Halo_V2_Auth::instance();
	}

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
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'init', array( $this, 'maybe_install_moderation_capability' ), 2 );
		add_action( 'admin_menu', array( $this, 'register_moderation_page' ) );
		add_action( 'admin_post_avenra_halo_community_moderate', array( $this, 'handle_moderation_action' ) );
	}

	public static function install_moderation_capability(): void {
		if ( self::MOD_CAP_VERSION === (string) get_option( 'avenra_halo_v2_community_cap_version', '' ) ) {
			return;
		}
		$administrator = get_role( 'administrator' );
		if ( $administrator instanceof WP_Role ) {
			$administrator->add_cap( self::CAP_MODERATE, true );
		}
		update_option( 'avenra_halo_v2_community_cap_version', self::MOD_CAP_VERSION, false );
	}

	public function maybe_install_moderation_capability(): void {
		self::install_moderation_capability();
	}

	public function register_routes(): void {
		$this->route( '/community/bootstrap', 'GET', 'bootstrap' );
		$this->route( '/community/profile', 'GET', 'get_profile' );
		$this->route( '/community/profile', array( 'PUT', 'PATCH' ), 'save_profile' );
		$this->route( '/community/profile', 'DELETE', 'deactivate_profile' );
		$this->route( '/community/members', 'GET', 'members' );
		$this->route( '/community/members/(?P<id>[a-fA-F0-9-]{36})', 'GET', 'member' );

		$this->route( '/community/threads', 'GET', 'threads' );
		$this->route( '/community/threads', 'POST', 'create_thread' );
		$this->route( '/community/threads/(?P<id>[a-fA-F0-9-]{36})', 'GET', 'thread' );
		$this->route( '/community/threads/(?P<id>[a-fA-F0-9-]{36})', array( 'PUT', 'PATCH' ), 'update_thread' );
		$this->route( '/community/threads/(?P<id>[a-fA-F0-9-]{36})', 'DELETE', 'delete_thread' );
		$this->route( '/community/threads/(?P<id>[a-fA-F0-9-]{36})/replies', 'GET', 'replies' );
		$this->route( '/community/threads/(?P<id>[a-fA-F0-9-]{36})/replies', 'POST', 'create_reply' );
		$this->route( '/community/replies/(?P<id>[a-fA-F0-9-]{36})', array( 'PUT', 'PATCH' ), 'update_reply' );
		$this->route( '/community/replies/(?P<id>[a-fA-F0-9-]{36})', 'DELETE', 'delete_reply' );

		$this->route( '/community/conversations', 'GET', 'conversations' );
		$this->route( '/community/conversations', 'POST', 'create_conversation' );
		$this->route( '/community/conversations/(?P<id>[a-fA-F0-9-]{36})/messages', 'GET', 'messages' );
		$this->route( '/community/conversations/(?P<id>[a-fA-F0-9-]{36})/messages', 'POST', 'send_message' );
		$this->route( '/community/conversations/(?P<id>[a-fA-F0-9-]{36})/read', 'POST', 'mark_conversation_read' );

		$this->route( '/community/blocks', 'GET', 'blocks' );
		$this->route( '/community/blocks', 'POST', 'create_block' );
		$this->route( '/community/blocks/(?P<id>[a-fA-F0-9-]{36})', 'DELETE', 'delete_block' );
		$this->route( '/community/reports', 'GET', 'reports' );
		$this->route( '/community/reports', 'POST', 'create_report' );
	}

	/** @param string|string[] $methods */
	private function route( string $path, string|array $methods, string $callback ): void {
		register_rest_route(
			self::NS,
			$path,
			array(
				'methods'             => $methods,
				'callback'            => array( $this, $callback ),
				'permission_callback' => array( $this->auth, 'permission_authenticated' ),
			)
		);
	}

	public function bootstrap( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$customer_id = $this->auth->customer_id();
		$profile = $this->profile_by_customer( $customer_id );
		$active = $this->profile_is_active( $profile );
		$unread = 0;
		if ( $active && $this->storage_ready() ) {
			$unread = (int) $wpdb->get_var(
				$wpdb->prepare(
					"SELECT COUNT(*) FROM `" . esc_sql( $this->db->table( 'community_messages' ) ) . "` WHERE recipient_customer_id = %d AND status = 'sent' AND read_at IS NULL", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					$customer_id
				)
			);
		}
		return Avenra_Halo_V2_Response::success(
			array(
				'enabled'       => $active,
				'profile'       => $this->own_profile( $profile ),
				'unread_messages'=> $unread,
				'terms'         => array( 'required_version' => self::TERMS_VERSION ),
				'privacy'       => array(
					'pseudonymous' => true,
					'default_off'  => true,
					'never_shared' => array( 'real_name', 'email', 'location', 'vehicle', 'emergency_data', 'ride_risk' ),
				),
			)
		);
	}

	public function get_profile( WP_REST_Request $request ): WP_REST_Response {
		return Avenra_Halo_V2_Response::success(
			array(
				'profile' => $this->own_profile( $this->profile_by_customer( $this->auth->customer_id() ) ),
				'required_terms_version' => self::TERMS_VERSION,
			)
		);
	}

	public function save_profile( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		if ( ! $this->storage_ready() ) {
			return $this->error( 'community_storage_unavailable', __( 'Halo Community storage is not ready.', 'avenra-halo-v2' ), 503 );
		}
		$customer_id = $this->auth->customer_id();
		if ( ! $this->limit( 'community-profile', (string) $customer_id, 12, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_profile_rate_limited', __( 'Please wait before changing your Community profile again.', 'avenra-halo-v2' ), 429 );
		}
		$body = $this->body( $request );
		if ( ! $this->truthy( $body['opt_in'] ?? false ) ) {
			return $this->error( 'community_opt_in_required', __( 'Explicitly opt in before creating a Community profile.', 'avenra-halo-v2' ), 422 );
		}
		$existing = $this->profile_by_customer( $customer_id );
		if ( is_object( $existing ) && 'suspended' === (string) $existing->status ) {
			return $this->error( 'community_profile_suspended', __( 'This Community profile is suspended and cannot be reactivated without moderator review.', 'avenra-halo-v2' ), 403 );
		}
		$reactivating = ! $this->profile_is_active( $existing );
		$terms = sanitize_text_field( (string) ( $body['terms_version'] ?? '' ) );
		if ( $reactivating && ! hash_equals( self::TERMS_VERSION, $terms ) ) {
			return $this->error( 'community_terms_required', __( 'Accept the current Community terms before joining.', 'avenra-halo-v2' ), 422, array( 'required_version' => self::TERMS_VERSION ) );
		}

		$username = $this->username( $body['username'] ?? ( is_object( $existing ) ? $existing->username : '' ) );
		if ( is_wp_error( $username ) ) {
			return $this->from_error( $username, 422 );
		}
		$bio = $this->plain_text( $body['bio'] ?? ( is_object( $existing ) ? $existing->bio : '' ), 280, 0, __( 'Bio', 'avenra-halo-v2' ), true );
		if ( is_wp_error( $bio ) ) {
			return $this->from_error( $bio, 422 );
		}
		$conflict = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT customer_id FROM `' . esc_sql( $this->db->table( 'community_profiles' ) ) . '` WHERE username_normalized = %s AND customer_id <> %d LIMIT 1', // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$username,
				$customer_id
			)
		);
		if ( $conflict > 0 ) {
			return $this->error( 'community_username_unavailable', __( 'That public username is already in use.', 'avenra-halo-v2' ), 409 );
		}

		$lock = $this->db->acquire_advisory_lock( 'community-profile', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return $this->error( 'community_profile_busy', __( 'Your Community profile is already being updated.', 'avenra-halo-v2' ), 409 );
		}
		try {
			$existing = $this->profile_by_customer( $customer_id );
			if ( is_object( $existing ) && 'suspended' === (string) $existing->status ) {
				return $this->error( 'community_profile_suspended', __( 'This Community profile is suspended and cannot be reactivated without moderator review.', 'avenra-halo-v2' ), 403 );
			}
			$reactivating = ! $this->profile_is_active( $existing );
			$now = current_time( 'mysql', true );
			$data = array(
				'username'            => $username,
				'username_normalized' => $username,
				'bio'                 => $bio,
				'allow_dms'           => $this->truthy( $body['allow_dms'] ?? ( is_object( $existing ) ? $existing->allow_dms : false ) ) ? 1 : 0,
				'directory_visible'   => $this->truthy( $body['directory_visible'] ?? ( is_object( $existing ) ? $existing->directory_visible : false ) ) ? 1 : 0,
				'status'              => 'active',
				'terms_version'       => self::TERMS_VERSION,
				'opted_in_at'         => $reactivating ? $now : ( $existing->opted_in_at ?? $now ),
				'deactivated_at'      => null,
				'updated_at'           => $now,
			);
			if ( is_object( $existing ) ) {
				$saved = $wpdb->update(
					$this->db->table( 'community_profiles' ),
					$data,
					array( 'customer_id' => $customer_id, 'status' => (string) $existing->status )
				);
			} else {
				$data['customer_id'] = $customer_id;
				$data['public_id'] = wp_generate_uuid4();
				$data['created_at'] = $now;
				$saved = $wpdb->insert( $this->db->table( 'community_profiles' ), $data );
			}
			if ( false === $saved ) {
				return $this->error( 'community_profile_failed', __( 'Your Community profile could not be saved.', 'avenra-halo-v2' ), 503 );
			}
			if ( 0 === $saved ) {
				$current = $this->profile_by_customer( $customer_id );
				if ( is_object( $current ) && 'suspended' === (string) $current->status ) {
					return $this->error( 'community_profile_suspended', __( 'This Community profile is suspended and cannot be reactivated without moderator review.', 'avenra-halo-v2' ), 403 );
				}
			}
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
		return Avenra_Halo_V2_Response::success( array( 'profile' => $this->own_profile( $this->profile_by_customer( $customer_id ) ) ) );
	}

	public function deactivate_profile( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$customer_id = $this->auth->customer_id();
		$profile = $this->profile_by_customer( $customer_id );
		if ( ! is_object( $profile ) || 'deactivated' === (string) $profile->status ) {
			return Avenra_Halo_V2_Response::success( array( 'deactivated' => true, 'idempotent' => true ) );
		}
		if ( 'suspended' === (string) $profile->status ) {
			return $this->error( 'community_profile_suspended', __( 'This Community profile is suspended and cannot be changed without moderator review.', 'avenra-halo-v2' ), 403 );
		}
		if ( ! $this->limit( 'community-profile-delete', (string) $customer_id, 3, DAY_IN_SECONDS ) ) {
			return $this->error( 'community_profile_delete_rate_limited', __( 'Please wait before changing your membership again.', 'avenra-halo-v2' ), 429 );
		}
		$lock = $this->db->acquire_advisory_lock( 'community-profile', (string) $customer_id, 2 );
		if ( ! $lock ) {
			return $this->error( 'community_profile_busy', __( 'Your Community profile is already being updated.', 'avenra-halo-v2' ), 409 );
		}
		try {
			$profile = $this->profile_by_customer( $customer_id );
			if ( ! is_object( $profile ) || 'deactivated' === (string) $profile->status ) {
				return Avenra_Halo_V2_Response::success( array( 'deactivated' => true, 'idempotent' => true ) );
			}
			if ( 'suspended' === (string) $profile->status ) {
				return $this->error( 'community_profile_suspended', __( 'This Community profile is suspended and cannot be changed without moderator review.', 'avenra-halo-v2' ), 403 );
			}
			if ( 'active' !== (string) $profile->status ) {
				return $this->error( 'community_profile_state_conflict', __( 'Your Community membership changed. Reload and try again.', 'avenra-halo-v2' ), 409 );
			}
			$now = current_time( 'mysql', true );
			$saved = $wpdb->update(
				$this->db->table( 'community_profiles' ),
				array( 'username' => null, 'username_normalized' => null, 'bio' => '', 'allow_dms' => 0, 'directory_visible' => 0, 'status' => 'deactivated', 'deactivated_at' => $now, 'updated_at' => $now ),
				array( 'customer_id' => $customer_id, 'status' => 'active' )
			);
			if ( false === $saved ) {
				return $this->error( 'community_profile_delete_failed', __( 'Your Community profile could not be deactivated.', 'avenra-halo-v2' ), 503 );
			}
			if ( 0 === $saved ) {
				$current = $this->profile_by_customer( $customer_id );
				if ( is_object( $current ) && 'suspended' === (string) $current->status ) {
					return $this->error( 'community_profile_suspended', __( 'This Community profile is suspended and cannot be changed without moderator review.', 'avenra-halo-v2' ), 403 );
				}
				if ( ! is_object( $current ) || 'deactivated' !== (string) $current->status ) {
					return $this->error( 'community_profile_state_conflict', __( 'Your Community membership changed. Reload and try again.', 'avenra-halo-v2' ), 409 );
				}
			}
			return Avenra_Halo_V2_Response::success( array( 'deactivated' => true, 'content_retained_for_safety' => true ) );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function members( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		if ( ! $this->limit( 'community-directory-read', (string) $customer_id, 180, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_directory_rate_limited', __( 'Please wait before loading more Community members.', 'avenra-halo-v2' ), 429 );
		}
		list( $page, $per_page, $offset ) = $this->pagination( $request );
		$blocked = $this->blocked_customer_ids( $customer_id );
		$where = "status = 'active' AND directory_visible = 1 AND terms_version = %s" . $this->not_in_clause( 'customer_id', $blocked );
		$args = array( self::TERMS_VERSION );
		$search = trim( sanitize_text_field( (string) $request->get_param( 'search' ) ) );
		if ( '' !== $search ) {
			$where .= ' AND (username LIKE %s OR bio LIKE %s)';
			$like = '%' . $wpdb->esc_like( $this->text_substr( $search, 0, 40 ) ) . '%';
			$args[] = $like;
			$args[] = $like;
		}
		$table = esc_sql( $this->db->table( 'community_profiles' ) );
		$count_sql = "SELECT COUNT(*) FROM `{$table}` WHERE {$where}";
		$list_sql = "SELECT public_id, username, bio, allow_dms, status, terms_version, opted_in_at, created_at FROM `{$table}` WHERE {$where} ORDER BY username ASC LIMIT %d OFFSET %d";
		$total = (int) $wpdb->get_var( $args ? $wpdb->prepare( $count_sql, ...$args ) : $count_sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$list_args = array_merge( $args, array( $per_page, $offset ) );
		$rows = $wpdb->get_results( $wpdb->prepare( $list_sql, ...$list_args ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return Avenra_Halo_V2_Response::success( array_map( array( $this, 'public_profile' ), (array) $rows ), 200, $this->page_meta( $page, $per_page, $total ) );
	}

	public function member( WP_REST_Request $request ): WP_REST_Response {
		$viewer = $this->require_profile();
		if ( is_wp_error( $viewer ) ) {
			return $this->from_error( $viewer, 403 );
		}
		$target = $this->profile_by_public_id( (string) $request['id'] );
		if ( ! $this->profile_is_active( $target ) || '1' !== (string) $target->directory_visible || $this->are_blocked( $this->auth->customer_id(), (int) $target->customer_id ) ) {
			return $this->error( 'community_member_missing', __( 'That Community member is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		return Avenra_Halo_V2_Response::success( $this->public_profile( $target ) );
	}

	public function threads( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		list( $page, $per_page, $offset ) = $this->pagination( $request );
		$blocked = $this->blocked_customer_ids( $this->auth->customer_id() );
		$where = "t.status = 'active'" . $this->not_in_clause( 't.author_customer_id', $blocked );
		$args = array();
		$search = trim( sanitize_text_field( (string) $request->get_param( 'search' ) ) );
		if ( '' !== $search ) {
			$where .= ' AND (t.title LIKE %s OR t.body LIKE %s)';
			$like = '%' . $wpdb->esc_like( $this->text_substr( $search, 0, 80 ) ) . '%';
			$args[] = $like;
			$args[] = $like;
		}
		$threads = esc_sql( $this->db->table( 'community_threads' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$count_sql = "SELECT COUNT(*) FROM `{$threads}` t WHERE {$where}";
		$list_sql = "SELECT t.*, p.public_id AS author_public_id, p.username AS author_username, p.status AS author_status, p.terms_version AS author_terms_version FROM `{$threads}` t LEFT JOIN `{$profiles}` p ON p.customer_id = t.author_customer_id WHERE {$where} ORDER BY t.last_activity_at DESC, t.id DESC LIMIT %d OFFSET %d";
		$total = (int) $wpdb->get_var( $args ? $wpdb->prepare( $count_sql, ...$args ) : $count_sql ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows = $wpdb->get_results( $wpdb->prepare( $list_sql, ...array_merge( $args, array( $per_page, $offset ) ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return Avenra_Halo_V2_Response::success( array_map( fn( object $row ): array => $this->public_thread( $row, false ), (array) $rows ), 200, $this->page_meta( $page, $per_page, $total ) );
	}

	public function create_thread( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		if ( ! $this->limit( 'community-thread-create', (string) $customer_id, 6, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_thread_rate_limited', __( 'Please wait before starting another discussion.', 'avenra-halo-v2' ), 429 );
		}
		$body = $this->body( $request );
		$title = $this->plain_text( $body['title'] ?? '', 100, 5, __( 'Title', 'avenra-halo-v2' ), false );
		$content = $this->plain_text( $body['body'] ?? '', 4000, 10, __( 'Discussion', 'avenra-halo-v2' ), true );
		if ( is_wp_error( $title ) || is_wp_error( $content ) ) {
			return $this->from_error( is_wp_error( $title ) ? $title : $content, 422 );
		}
		$now = current_time( 'mysql', true );
		$public_id = wp_generate_uuid4();
		$threads = esc_sql( $this->db->table( 'community_threads' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$saved = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO `{$threads}` (public_id,author_customer_id,title,body,status,reply_count,last_activity_at,created_at,updated_at) SELECT %s,p.customer_id,%s,%s,'active',0,%s,%s,%s FROM `{$profiles}` p WHERE p.customer_id = %d AND p.status = 'active' AND p.terms_version = %s AND p.username IS NOT NULL AND p.username <> '' LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$public_id,
				$title,
				$content,
				$now,
				$now,
				$now,
				$customer_id,
				self::TERMS_VERSION
			)
		);
		if ( false === $saved ) {
			return $this->error( 'community_thread_failed', __( 'The discussion could not be created.', 'avenra-halo-v2' ), 503 );
		}
		if ( 1 !== (int) $saved ) {
			return $this->error( 'community_thread_state_changed', __( 'Your Community membership changed before the discussion could be published.', 'avenra-halo-v2' ), 409 );
		}
		return Avenra_Halo_V2_Response::success( $this->public_thread( $this->thread_with_author( $public_id ), true ), 201 );
	}

	public function thread( WP_REST_Request $request ): WP_REST_Response {
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$row = $this->thread_with_author( (string) $request['id'] );
		if ( ! is_object( $row ) || 'active' !== (string) $row->status || $this->are_blocked( $this->auth->customer_id(), (int) $row->author_customer_id ) ) {
			return $this->error( 'community_thread_missing', __( 'That discussion is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		return Avenra_Halo_V2_Response::success( $this->public_thread( $row, true ) );
	}

	public function update_thread( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		$row = $this->thread_by_public_id( (string) $request['id'] );
		if ( ! is_object( $row ) || (int) $row->author_customer_id !== $customer_id ) {
			return $this->error( 'community_thread_owner_required', __( 'You cannot edit that discussion.', 'avenra-halo-v2' ), 403 );
		}
		if ( 'locked' === (string) $row->status ) {
			return $this->error( 'community_thread_locked', __( 'That discussion is locked.', 'avenra-halo-v2' ), 409 );
		}
		if ( 'active' !== (string) $row->status ) {
			return $this->error( 'community_thread_unavailable', __( 'That discussion can no longer be edited.', 'avenra-halo-v2' ), 409 );
		}
		if ( ! $this->limit( 'community-thread-edit', (string) $customer_id, 20, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_thread_edit_rate_limited', __( 'Please wait before editing again.', 'avenra-halo-v2' ), 429 );
		}
		$body = $this->body( $request );
		$title = $this->plain_text( $body['title'] ?? $row->title, 100, 5, __( 'Title', 'avenra-halo-v2' ), false );
		$content = $this->plain_text( $body['body'] ?? $row->body, 4000, 10, __( 'Discussion', 'avenra-halo-v2' ), true );
		if ( is_wp_error( $title ) || is_wp_error( $content ) ) {
			return $this->from_error( is_wp_error( $title ) ? $title : $content, 422 );
		}
		$threads = esc_sql( $this->db->table( 'community_threads' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$saved = $wpdb->query(
			$wpdb->prepare(
				"UPDATE `{$threads}` t INNER JOIN `{$profiles}` p ON p.customer_id = t.author_customer_id SET t.title = %s, t.body = %s, t.updated_at = %s WHERE t.id = %d AND t.author_customer_id = %d AND t.status = 'active' AND p.status = 'active' AND p.terms_version = %s", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$title,
				$content,
				current_time( 'mysql', true ),
				(int) $row->id,
				$customer_id,
				self::TERMS_VERSION
			)
		);
		if ( false === $saved ) {
			return $this->error( 'community_thread_update_failed', __( 'The discussion could not be updated.', 'avenra-halo-v2' ), 503 );
		}
		$current = $this->thread_by_public_id( (string) $row->public_id );
		if ( ! is_object( $current ) || 'active' !== (string) $current->status || ! $this->profile_is_active( $this->profile_by_customer( $customer_id ) ) ) {
			return $this->error( 'community_thread_state_changed', __( 'The discussion or your Community membership changed before the edit was saved.', 'avenra-halo-v2' ), 409 );
		}
		return Avenra_Halo_V2_Response::success( $this->public_thread( $this->thread_with_author( (string) $row->public_id ), true ) );
	}

	public function delete_thread( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		$row = $this->thread_by_public_id( (string) $request['id'] );
		if ( ! is_object( $row ) || (int) $row->author_customer_id !== $customer_id ) {
			return $this->error( 'community_thread_owner_required', __( 'You cannot remove that discussion.', 'avenra-halo-v2' ), 403 );
		}
		if ( 'removed' === (string) $row->status ) {
			return Avenra_Halo_V2_Response::success( array( 'removed' => true, 'idempotent' => true ) );
		}
		if ( 'active' !== (string) $row->status ) {
			return $this->error( 'community_thread_unavailable', __( 'That discussion cannot be changed.', 'avenra-halo-v2' ), 409 );
		}
		$threads = esc_sql( $this->db->table( 'community_threads' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$saved = $wpdb->query(
			$wpdb->prepare(
				"UPDATE `{$threads}` t INNER JOIN `{$profiles}` p ON p.customer_id = t.author_customer_id SET t.status = 'removed', t.updated_at = %s WHERE t.id = %d AND t.author_customer_id = %d AND t.status = 'active' AND p.status = 'active' AND p.terms_version = %s", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				current_time( 'mysql', true ),
				(int) $row->id,
				$customer_id,
				self::TERMS_VERSION
			)
		);
		if ( false === $saved ) {
			return $this->error( 'community_thread_delete_failed', __( 'The discussion could not be removed.', 'avenra-halo-v2' ), 503 );
		}
		$current = $this->thread_by_public_id( (string) $row->public_id );
		return is_object( $current ) && 'removed' === (string) $current->status
			? Avenra_Halo_V2_Response::success( array( 'removed' => true, 'idempotent' => 0 === $saved ) )
			: $this->error( 'community_thread_state_changed', __( 'The discussion or your Community membership changed before it could be removed.', 'avenra-halo-v2' ), 409 );
	}

	public function replies( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$thread = $this->thread_by_public_id( (string) $request['id'] );
		if ( ! is_object( $thread ) || 'active' !== (string) $thread->status || $this->are_blocked( $this->auth->customer_id(), (int) $thread->author_customer_id ) ) {
			return $this->error( 'community_thread_missing', __( 'That discussion is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		list( $page, $per_page, $offset ) = $this->pagination( $request );
		$blocked = $this->blocked_customer_ids( $this->auth->customer_id() );
		$where = "r.thread_id = %d AND r.status = 'active'" . $this->not_in_clause( 'r.author_customer_id', $blocked );
		$replies = esc_sql( $this->db->table( 'community_replies' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM `{$replies}` r WHERE {$where}", (int) $thread->id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT r.*, p.public_id AS author_public_id, p.username AS author_username, p.status AS author_status, p.terms_version AS author_terms_version FROM `{$replies}` r LEFT JOIN `{$profiles}` p ON p.customer_id = r.author_customer_id WHERE {$where} ORDER BY r.created_at ASC, r.id ASC LIMIT %d OFFSET %d", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				(int) $thread->id,
				$per_page,
				$offset
			)
		);
		return Avenra_Halo_V2_Response::success( array_map( array( $this, 'public_reply' ), (array) $rows ), 200, $this->page_meta( $page, $per_page, $total ) );
	}

	public function create_reply( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$thread = $this->thread_by_public_id( (string) $request['id'] );
		if ( ! is_object( $thread ) || 'active' !== (string) $thread->status ) {
			return $this->error( 'community_thread_missing', __( 'That discussion is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		if ( $this->are_blocked( $this->auth->customer_id(), (int) $thread->author_customer_id ) ) {
			return $this->error( 'community_interaction_blocked', __( 'You cannot interact with that member.', 'avenra-halo-v2' ), 403 );
		}
		if ( ! $this->limit( 'community-reply-create', (string) $this->auth->customer_id(), 40, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_reply_rate_limited', __( 'Please wait before posting another reply.', 'avenra-halo-v2' ), 429 );
		}
		$content = $this->plain_text( $this->body( $request )['body'] ?? '', 2000, 2, __( 'Reply', 'avenra-halo-v2' ), true );
		if ( is_wp_error( $content ) ) {
			return $this->from_error( $content, 422 );
		}
		$now = current_time( 'mysql', true );
		$public_id = wp_generate_uuid4();
		$customer_id = $this->auth->customer_id();
		$replies = esc_sql( $this->db->table( 'community_replies' ) );
		$threads = esc_sql( $this->db->table( 'community_threads' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$blocks = esc_sql( $this->db->table( 'community_blocks' ) );
		$transaction_open = false;
		$committed = false;
		$state_changed = false;
		try {
			if ( false !== $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				$transaction_open = true;
				$saved = $wpdb->query(
					$wpdb->prepare(
						"INSERT INTO `{$replies}` (public_id,thread_id,author_customer_id,body,status,created_at,updated_at) SELECT %s,t.id,p.customer_id,%s,'active',%s,%s FROM `{$profiles}` p INNER JOIN `{$threads}` t ON t.id = %d WHERE p.customer_id = %d AND p.status = 'active' AND p.terms_version = %s AND p.username IS NOT NULL AND p.username <> '' AND t.status = 'active' AND NOT EXISTS (SELECT 1 FROM `{$blocks}` b WHERE (b.blocker_customer_id = p.customer_id AND b.blocked_customer_id = t.author_customer_id) OR (b.blocker_customer_id = t.author_customer_id AND b.blocked_customer_id = p.customer_id)) LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						$public_id,
						$content,
						$now,
						$now,
						(int) $thread->id,
						$customer_id,
						self::TERMS_VERSION
					)
				);
				if ( 1 === (int) $saved ) {
					$count_updated = $wpdb->query( $wpdb->prepare( "UPDATE `{$threads}` SET reply_count = reply_count + 1, last_activity_at = %s, updated_at = %s WHERE id = %d AND status = 'active'", $now, $now, (int) $thread->id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
					if ( 1 === (int) $count_updated ) {
						if ( false !== $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
							$transaction_open = false;
							$committed = true;
						}
					} elseif ( false !== $count_updated ) {
						$state_changed = true;
					}
				} elseif ( false !== $saved ) {
					$state_changed = true;
				}
			}
		} catch ( Throwable $error ) {
			$committed = false;
		} finally {
			if ( $transaction_open ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			}
		}
		if ( ! $committed ) {
			return $state_changed
				? $this->error( 'community_reply_state_changed', __( 'The discussion, block state or your Community membership changed before the reply could be published.', 'avenra-halo-v2' ), 409 )
				: $this->error( 'community_reply_failed', __( 'Your reply could not be posted.', 'avenra-halo-v2' ), 503 );
		}
		return Avenra_Halo_V2_Response::success( $this->public_reply( $this->reply_with_author( $public_id ) ), 201 );
	}

	public function update_reply( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		$row = $this->reply_by_public_id( (string) $request['id'] );
		if ( ! is_object( $row ) || (int) $row->author_customer_id !== $customer_id || 'active' !== (string) $row->status ) {
			return $this->error( 'community_reply_owner_required', __( 'You cannot edit that reply.', 'avenra-halo-v2' ), 403 );
		}
		if ( ! $this->limit( 'community-reply-edit', (string) $customer_id, 30, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_reply_edit_rate_limited', __( 'Please wait before editing again.', 'avenra-halo-v2' ), 429 );
		}
		$content = $this->plain_text( $this->body( $request )['body'] ?? $row->body, 2000, 2, __( 'Reply', 'avenra-halo-v2' ), true );
		if ( is_wp_error( $content ) ) {
			return $this->from_error( $content, 422 );
		}
		$replies = esc_sql( $this->db->table( 'community_replies' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$saved = $wpdb->query(
			$wpdb->prepare(
				"UPDATE `{$replies}` r INNER JOIN `{$profiles}` p ON p.customer_id = r.author_customer_id SET r.body = %s, r.updated_at = %s WHERE r.id = %d AND r.author_customer_id = %d AND r.status = 'active' AND p.status = 'active' AND p.terms_version = %s", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$content,
				current_time( 'mysql', true ),
				(int) $row->id,
				$customer_id,
				self::TERMS_VERSION
			)
		);
		if ( false === $saved ) {
			return $this->error( 'community_reply_update_failed', __( 'The reply could not be updated.', 'avenra-halo-v2' ), 503 );
		}
		$current = $this->reply_by_public_id( (string) $row->public_id );
		if ( ! is_object( $current ) || 'active' !== (string) $current->status || ! $this->profile_is_active( $this->profile_by_customer( $customer_id ) ) ) {
			return $this->error( 'community_reply_state_changed', __( 'The reply or your Community membership changed before the edit was saved.', 'avenra-halo-v2' ), 409 );
		}
		return Avenra_Halo_V2_Response::success( $this->public_reply( $this->reply_with_author( (string) $row->public_id ) ) );
	}

	public function delete_reply( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		$row = $this->reply_by_public_id( (string) $request['id'] );
		if ( ! is_object( $row ) || (int) $row->author_customer_id !== $customer_id ) {
			return $this->error( 'community_reply_owner_required', __( 'You cannot remove that reply.', 'avenra-halo-v2' ), 403 );
		}
		if ( 'removed' === (string) $row->status ) {
			return Avenra_Halo_V2_Response::success( array( 'removed' => true, 'idempotent' => true ) );
		}
		if ( 'active' !== (string) $row->status ) {
			return $this->error( 'community_reply_unavailable', __( 'That reply cannot be changed.', 'avenra-halo-v2' ), 409 );
		}
		$now = current_time( 'mysql', true );
		$replies = esc_sql( $this->db->table( 'community_replies' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$saved = $wpdb->query(
			$wpdb->prepare(
				"UPDATE `{$replies}` r INNER JOIN `{$profiles}` p ON p.customer_id = r.author_customer_id SET r.status = 'removed', r.updated_at = %s WHERE r.id = %d AND r.author_customer_id = %d AND r.status = 'active' AND p.status = 'active' AND p.terms_version = %s", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				$now,
				(int) $row->id,
				$customer_id,
				self::TERMS_VERSION
			)
		);
		if ( false === $saved ) {
			return $this->error( 'community_reply_delete_failed', __( 'The reply could not be removed.', 'avenra-halo-v2' ), 503 );
		}
		$current = $this->reply_by_public_id( (string) $row->public_id );
		if ( ! is_object( $current ) || 'removed' !== (string) $current->status ) {
			return $this->error( 'community_reply_state_changed', __( 'The reply or your Community membership changed before it could be removed.', 'avenra-halo-v2' ), 409 );
		}
		if ( 0 === $saved ) {
			return Avenra_Halo_V2_Response::success( array( 'removed' => true, 'idempotent' => true ) );
		}
		$wpdb->query( $wpdb->prepare( 'UPDATE `' . esc_sql( $this->db->table( 'community_threads' ) ) . '` SET reply_count = GREATEST(0, reply_count - 1), updated_at = %s WHERE id = %d', $now, (int) $row->thread_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return Avenra_Halo_V2_Response::success( array( 'removed' => true ) );
	}

	public function conversations( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		list( $page, $per_page, $offset ) = $this->pagination( $request, 30 );
		$customer_id = $this->auth->customer_id();
		$table = esc_sql( $this->db->table( 'community_conversations' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$where = '(c.customer_low_id = %d OR c.customer_high_id = %d)';
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM `{$table}` c WHERE {$where}", $customer_id, $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$list_sql = "SELECT c.*, p.public_id AS other_public_id, p.username AS other_username, p.bio AS other_bio, p.allow_dms AS other_allow_dms, p.status AS other_status, p.terms_version AS other_terms_version, p.opted_in_at AS other_opted_in_at, p.created_at AS other_created_at FROM `{$table}` c LEFT JOIN `{$profiles}` p ON p.customer_id = IF(c.customer_low_id = %d, c.customer_high_id, c.customer_low_id) WHERE {$where} ORDER BY c.last_message_at DESC, c.id DESC LIMIT %d OFFSET %d";
		$rows = $wpdb->get_results( $wpdb->prepare( $list_sql, $customer_id, $customer_id, $customer_id, $per_page, $offset ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$output = array();
		foreach ( (array) $rows as $row ) {
			$output[] = $this->public_conversation( $row, $customer_id );
		}
		return Avenra_Halo_V2_Response::success( $output, 200, $this->page_meta( $page, $per_page, $total ) );
	}

	public function create_conversation( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$body = $this->body( $request );
		$target = $this->profile_by_public_id( sanitize_text_field( (string) ( $body['member_id'] ?? '' ) ) );
		if ( ! $this->profile_is_active( $target ) || '1' !== (string) $target->directory_visible ) {
			return $this->error( 'community_dm_member_missing', __( 'That Community member is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		$customer_id = $this->auth->customer_id();
		$target_id = (int) $target->customer_id;
		if ( $customer_id === $target_id ) {
			return $this->error( 'community_dm_self', __( 'Choose another Community member.', 'avenra-halo-v2' ), 422 );
		}
		if ( '1' !== (string) $target->allow_dms ) {
			return $this->error( 'community_dms_disabled', __( 'That member is not accepting new direct messages.', 'avenra-halo-v2' ), 409 );
		}
		if ( $this->are_blocked( $customer_id, $target_id ) ) {
			return $this->error( 'community_interaction_blocked', __( 'Direct messages are unavailable for these members.', 'avenra-halo-v2' ), 403 );
		}
		if ( ! $this->limit( 'community-conversation-create', (string) $customer_id, 12, DAY_IN_SECONDS ) ) {
			return $this->error( 'community_conversation_rate_limited', __( 'Please wait before starting another conversation.', 'avenra-halo-v2' ), 429 );
		}
		$low = min( $customer_id, $target_id );
		$high = max( $customer_id, $target_id );
		$lock = $this->db->acquire_advisory_lock( 'community-member-pair', $this->member_pair_identifier( $customer_id, $target_id ), 2 );
		if ( ! $lock ) {
			return $this->error( 'community_conversation_busy', __( 'That conversation is already being created.', 'avenra-halo-v2' ), 409 );
		}
		try {
			if ( ! $this->dm_interaction_allowed( $customer_id, $target_id, true ) ) {
				return $this->error( 'community_conversation_state_changed', __( 'The member, direct-message or block state changed before the conversation could be created.', 'avenra-halo-v2' ), 409 );
			}
			$conversations = esc_sql( $this->db->table( 'community_conversations' ) );
			$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
			$blocks = esc_sql( $this->db->table( 'community_blocks' ) );
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `{$conversations}` WHERE customer_low_id = %d AND customer_high_id = %d LIMIT 1", $low, $high ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( ! is_object( $row ) ) {
				$now = current_time( 'mysql', true );
				$public_id = wp_generate_uuid4();
				$saved = $wpdb->query(
					$wpdb->prepare(
						"INSERT INTO `{$conversations}` (public_id,customer_low_id,customer_high_id,last_message_at,created_at,updated_at) SELECT %s,%d,%d,%s,%s,%s FROM `{$profiles}` sp INNER JOIN `{$profiles}` rp ON rp.customer_id = %d WHERE sp.customer_id = %d AND sp.status = 'active' AND sp.terms_version = %s AND sp.username IS NOT NULL AND sp.username <> '' AND rp.status = 'active' AND rp.terms_version = %s AND rp.username IS NOT NULL AND rp.username <> '' AND rp.directory_visible = 1 AND rp.allow_dms = 1 AND NOT EXISTS (SELECT 1 FROM `{$blocks}` b WHERE (b.blocker_customer_id = sp.customer_id AND b.blocked_customer_id = rp.customer_id) OR (b.blocker_customer_id = rp.customer_id AND b.blocked_customer_id = sp.customer_id)) LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						$public_id,
						$low,
						$high,
						$now,
						$now,
						$now,
						$target_id,
						$customer_id,
						self::TERMS_VERSION,
						self::TERMS_VERSION
					)
				);
				if ( false === $saved ) {
					return $this->error( 'community_conversation_failed', __( 'The conversation could not be created.', 'avenra-halo-v2' ), 503 );
				}
				if ( 1 !== (int) $saved ) {
					return $this->error( 'community_conversation_state_changed', __( 'The member, direct-message or block state changed before the conversation could be created.', 'avenra-halo-v2' ), 409 );
				}
				$row = $this->conversation_by_public_id( $public_id );
			}
			if ( ! is_object( $row ) ) {
				return $this->error( 'community_conversation_failed', __( 'The conversation could not be refreshed.', 'avenra-halo-v2' ), 503 );
			}
			$message = trim( (string) ( $body['message'] ?? '' ) );
			if ( '' !== $message ) {
				$sent = $this->insert_message( $row, $message, $customer_id );
				if ( is_wp_error( $sent ) ) {
					return $this->from_error( $sent, 422 );
				}
			}
			return Avenra_Halo_V2_Response::success( $this->public_conversation( $row, $customer_id ), 201 );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function messages( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$conversation = $this->owned_conversation( (string) $request['id'], $this->auth->customer_id() );
		if ( ! is_object( $conversation ) ) {
			return $this->error( 'community_conversation_missing', __( 'That conversation is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		list( $page, $per_page, $offset ) = $this->pagination( $request, 50 );
		$table = esc_sql( $this->db->table( 'community_messages' ) );
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM `{$table}` WHERE conversation_id = %d AND status = 'sent'", (int) $conversation->id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM `{$table}` WHERE conversation_id = %d AND status = 'sent' ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d", (int) $conversation->id, $per_page, $offset ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows = array_reverse( (array) $rows );
		return Avenra_Halo_V2_Response::success( array_map( fn( object $row ): array => $this->public_message( $row, $this->auth->customer_id() ), $rows ), 200, $this->page_meta( $page, $per_page, $total ) );
	}

	public function send_message( WP_REST_Request $request ): WP_REST_Response {
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		$conversation = $this->owned_conversation( (string) $request['id'], $customer_id );
		if ( ! is_object( $conversation ) ) {
			return $this->error( 'community_conversation_missing', __( 'That conversation is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		$other_id = $this->conversation_other_id( $conversation, $customer_id );
		$other = $this->profile_by_customer( $other_id );
		if ( ! $this->profile_is_active( $other ) || '1' !== (string) $other->allow_dms ) {
			return $this->error( 'community_dms_disabled', __( 'That member is not accepting direct messages.', 'avenra-halo-v2' ), 409 );
		}
		if ( $this->are_blocked( $customer_id, $other_id ) ) {
			return $this->error( 'community_interaction_blocked', __( 'Direct messages are unavailable for these members.', 'avenra-halo-v2' ), 403 );
		}
		if ( ! $this->limit( 'community-message-send', (string) $customer_id, 80, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_message_rate_limited', __( 'Please wait before sending another message.', 'avenra-halo-v2' ), 429 );
		}
		$lock = $this->db->acquire_advisory_lock( 'community-member-pair', $this->member_pair_identifier( $customer_id, $other_id ), 2 );
		if ( ! $lock ) {
			return $this->error( 'community_message_busy', __( 'That direct-message connection is being updated. Please try again.', 'avenra-halo-v2' ), 409 );
		}
		try {
			// Re-read ownership and the current state of both members after the pair lock is held.
			$conversation = $this->owned_conversation( (string) $request['id'], $customer_id );
			if ( ! is_object( $conversation ) ) {
				return $this->error( 'community_conversation_missing', __( 'That conversation is unavailable.', 'avenra-halo-v2' ), 404 );
			}
			$other_id = $this->conversation_other_id( $conversation, $customer_id );
			if ( ! $this->dm_interaction_allowed( $customer_id, $other_id, false ) ) {
				return $this->error( 'community_message_state_changed', __( 'The member, direct-message or block state changed before the message could be sent.', 'avenra-halo-v2' ), 409 );
			}
			$result = $this->insert_message( $conversation, $this->body( $request )['body'] ?? '', $customer_id );
			return is_wp_error( $result ) ? $this->from_error( $result, 422 ) : Avenra_Halo_V2_Response::success( $result, 201 );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function mark_conversation_read( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$conversation = $this->owned_conversation( (string) $request['id'], $this->auth->customer_id() );
		if ( ! is_object( $conversation ) ) {
			return $this->error( 'community_conversation_missing', __( 'That conversation is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		$now = current_time( 'mysql', true );
		$updated = $wpdb->query( $wpdb->prepare( "UPDATE `" . esc_sql( $this->db->table( 'community_messages' ) ) . "` SET read_at = %s WHERE conversation_id = %d AND recipient_customer_id = %d AND status = 'sent' AND read_at IS NULL", $now, (int) $conversation->id, $this->auth->customer_id() ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return false === $updated ? $this->error( 'community_message_read_failed', __( 'The read state could not be saved.', 'avenra-halo-v2' ), 503 ) : Avenra_Halo_V2_Response::success( array( 'read' => true, 'updated' => (int) $updated ) );
	}

	public function blocks( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$blocks = esc_sql( $this->db->table( 'community_blocks' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT p.* FROM `{$blocks}` b INNER JOIN `{$profiles}` p ON p.customer_id = b.blocked_customer_id WHERE b.blocker_customer_id = %d ORDER BY b.created_at DESC LIMIT 500", $this->auth->customer_id() ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return Avenra_Halo_V2_Response::success( array_map( array( $this, 'public_profile' ), (array) $rows ) );
	}

	public function create_block( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$target = $this->profile_by_public_id( sanitize_text_field( (string) ( $this->body( $request )['member_id'] ?? '' ) ) );
		if ( ! is_object( $target ) ) {
			return $this->error( 'community_member_missing', __( 'That Community member is unavailable.', 'avenra-halo-v2' ), 404 );
		}
		$customer_id = $this->auth->customer_id();
		if ( $customer_id === (int) $target->customer_id ) {
			return $this->error( 'community_block_self', __( 'You cannot block your own profile.', 'avenra-halo-v2' ), 422 );
		}
		if ( ! $this->limit( 'community-block', (string) $customer_id, 40, HOUR_IN_SECONDS ) ) {
			return $this->error( 'community_block_rate_limited', __( 'Please wait before changing more blocks.', 'avenra-halo-v2' ), 429 );
		}
		$target_id = (int) $target->customer_id;
		$lock = $this->db->acquire_advisory_lock( 'community-member-pair', $this->member_pair_identifier( $customer_id, $target_id ), 2 );
		if ( ! $lock ) {
			return $this->error( 'community_block_busy', __( 'That member connection is being updated. Please try again.', 'avenra-halo-v2' ), 409 );
		}
		try {
			// Membership and target identity may have changed while the request waited for the pair lock.
			if ( is_wp_error( $this->require_profile() ) ) {
				return $this->error( 'community_block_state_changed', __( 'Your Community membership changed before the block could be saved.', 'avenra-halo-v2' ), 409 );
			}
			$current_target = $this->profile_by_customer( $target_id );
			if ( ! is_object( $current_target ) || $customer_id === (int) $current_target->customer_id ) {
				return $this->error( 'community_block_state_changed', __( 'That Community member changed before the block could be saved.', 'avenra-halo-v2' ), 409 );
			}
			$existing = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM `' . esc_sql( $this->db->table( 'community_blocks' ) ) . '` WHERE blocker_customer_id = %d AND blocked_customer_id = %d LIMIT 1', $customer_id, $target_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( $existing < 1 ) {
				$saved = $wpdb->insert( $this->db->table( 'community_blocks' ), array( 'blocker_customer_id' => $customer_id, 'blocked_customer_id' => $target_id, 'created_at' => current_time( 'mysql', true ) ) );
				if ( false === $saved ) {
					return $this->error( 'community_block_failed', __( 'That member could not be blocked.', 'avenra-halo-v2' ), 503 );
				}
			}
			return Avenra_Halo_V2_Response::success( array( 'blocked' => true, 'member_id' => sanitize_text_field( (string) $current_target->public_id ) ), 201 );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function delete_block( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$target = $this->profile_by_public_id( (string) $request['id'] );
		if ( ! is_object( $target ) ) {
			return Avenra_Halo_V2_Response::success( array( 'blocked' => false, 'idempotent' => true ) );
		}
		$customer_id = $this->auth->customer_id();
		$target_id = (int) $target->customer_id;
		if ( $customer_id === $target_id ) {
			return Avenra_Halo_V2_Response::success( array( 'blocked' => false, 'idempotent' => true ) );
		}
		$lock = $this->db->acquire_advisory_lock( 'community-member-pair', $this->member_pair_identifier( $customer_id, $target_id ), 2 );
		if ( ! $lock ) {
			return $this->error( 'community_unblock_busy', __( 'That member connection is being updated. Please try again.', 'avenra-halo-v2' ), 409 );
		}
		try {
			$current_target = $this->profile_by_customer( $target_id );
			if ( ! is_object( $current_target ) ) {
				return Avenra_Halo_V2_Response::success( array( 'blocked' => false, 'idempotent' => true ) );
			}
			$deleted = $wpdb->delete( $this->db->table( 'community_blocks' ), array( 'blocker_customer_id' => $customer_id, 'blocked_customer_id' => $target_id ) );
			return false === $deleted
				? $this->error( 'community_unblock_failed', __( 'That block could not be removed.', 'avenra-halo-v2' ), 503 )
				: Avenra_Halo_V2_Response::success( array( 'blocked' => false, 'idempotent' => 0 === (int) $deleted ) );
		} finally {
			$this->db->release_advisory_lock( $lock );
		}
	}

	public function reports( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		list( $page, $per_page, $offset ) = $this->pagination( $request, 30 );
		$table = esc_sql( $this->db->table( 'community_reports' ) );
		$total = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM `{$table}` WHERE reporter_customer_id = %d", $this->auth->customer_id() ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT public_id, target_type, target_public_id, reason, details, status, created_at, updated_at, resolved_at FROM `{$table}` WHERE reporter_customer_id = %d ORDER BY created_at DESC LIMIT %d OFFSET %d", $this->auth->customer_id(), $per_page, $offset ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		foreach ( (array) $rows as &$row ) {
			$row['details'] = sanitize_textarea_field( (string) $row['details'] );
			foreach ( array( 'public_id', 'target_public_id', 'reason', 'status' ) as $field ) {
				$row[ $field ] = sanitize_text_field( (string) $row[ $field ] );
			}
			foreach ( array( 'created_at', 'updated_at', 'resolved_at' ) as $field ) {
				$row[ $field ] = $this->rfc3339( $row[ $field ] ?? null );
			}
		}
		unset( $row );
		return Avenra_Halo_V2_Response::success( (array) $rows, 200, $this->page_meta( $page, $per_page, $total ) );
	}

	public function create_report( WP_REST_Request $request ): WP_REST_Response {
		global $wpdb;
		$profile = $this->require_profile();
		if ( is_wp_error( $profile ) ) {
			return $this->from_error( $profile, 403 );
		}
		$customer_id = $this->auth->customer_id();
		if ( ! $this->limit( 'community-report', (string) $customer_id, 12, DAY_IN_SECONDS ) ) {
			return $this->error( 'community_report_rate_limited', __( 'Please wait before submitting another report.', 'avenra-halo-v2' ), 429 );
		}
		$body = $this->body( $request );
		$type = sanitize_key( (string) ( $body['target_type'] ?? '' ) );
		$target_id = strtolower( sanitize_text_field( (string) ( $body['target_id'] ?? '' ) ) );
		$reason = sanitize_key( (string) ( $body['reason'] ?? '' ) );
		if ( ! in_array( $type, array( 'profile', 'thread', 'reply', 'message' ), true ) || ! preg_match( '/^[a-f0-9-]{36}$/', $target_id ) || ! in_array( $reason, array( 'harassment', 'spam', 'hate', 'privacy', 'unsafe', 'impersonation', 'other' ), true ) ) {
			return $this->error( 'community_report_invalid', __( 'Choose valid report details.', 'avenra-halo-v2' ), 422 );
		}
		$details = $this->plain_text( $body['details'] ?? '', 500, 0, __( 'Report details', 'avenra-halo-v2' ), true );
		if ( is_wp_error( $details ) ) {
			return $this->from_error( $details, 422 );
		}
		$target = $this->report_target( $type, $target_id, $customer_id );
		if ( is_wp_error( $target ) ) {
			return $this->from_error( $target, 404 );
		}
		if ( (int) $target['customer_id'] === $customer_id ) {
			return $this->error( 'community_report_self', __( 'You cannot report your own Community content.', 'avenra-halo-v2' ), 422 );
		}
		$now = current_time( 'mysql', true );
		$public_id = wp_generate_uuid4();
		$saved = $wpdb->insert(
			$this->db->table( 'community_reports' ),
			array( 'public_id' => $public_id, 'reporter_customer_id' => $customer_id, 'target_type' => $type, 'target_public_id' => $target_id, 'target_customer_id' => (int) $target['customer_id'], 'reason' => $reason, 'details' => $details, 'status' => 'open', 'created_at' => $now, 'updated_at' => $now )
		);
		if ( false === $saved ) {
			$duplicate = (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM `' . esc_sql( $this->db->table( 'community_reports' ) ) . '` WHERE reporter_customer_id = %d AND target_type = %s AND target_public_id = %s LIMIT 1', $customer_id, $type, $target_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return $duplicate > 0 ? $this->error( 'community_report_exists', __( 'You already reported that item.', 'avenra-halo-v2' ), 409 ) : $this->error( 'community_report_failed', __( 'The report could not be submitted.', 'avenra-halo-v2' ), 503 );
		}
		return Avenra_Halo_V2_Response::success( array( 'report_id' => $public_id, 'status' => 'open' ), 201 );
	}

	/** WordPress moderation queue; never exposes customer-table identity data. */
	public function register_moderation_page(): void {
		add_management_page( __( 'Halo Community Reports', 'avenra-halo-v2' ), __( 'Halo Community Reports', 'avenra-halo-v2' ), self::CAP_MODERATE, self::ADMIN_SLUG, array( $this, 'render_moderation_page' ) );
	}

	public function render_moderation_page(): void {
		global $wpdb;
		if ( ! current_user_can( self::CAP_MODERATE ) ) {
			wp_die( esc_html__( 'You are not authorised to moderate Halo Community.', 'avenra-halo-v2' ), '', array( 'response' => 403 ) );
		}
		$status = isset( $_GET['status'] ) ? sanitize_key( wp_unslash( $_GET['status'] ) ) : 'open'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
		$status = in_array( $status, array( 'open', 'reviewing', 'resolved', 'dismissed' ), true ) ? $status : 'open';
		$reports = $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_reports' ) ) . '` WHERE status = %s ORDER BY created_at ASC LIMIT 200', $status ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Halo Community Reports', 'avenra-halo-v2' ); ?></h1>
			<p><?php esc_html_e( 'Pseudonymous moderation queue. Customer names, email addresses, rides, locations, vehicles and safety data are intentionally unavailable here.', 'avenra-halo-v2' ); ?></p>
			<nav class="nav-tab-wrapper">
				<?php foreach ( array( 'open', 'reviewing', 'resolved', 'dismissed' ) as $filter ) : ?><a class="nav-tab <?php echo $status === $filter ? 'nav-tab-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( array( 'page' => self::ADMIN_SLUG, 'status' => $filter ), admin_url( 'tools.php' ) ) ); ?>"><?php echo esc_html( ucfirst( $filter ) ); ?></a><?php endforeach; ?>
			</nav>
			<table class="widefat striped"><thead><tr><th><?php esc_html_e( 'Reported', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Target', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Reason', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Details', 'avenra-halo-v2' ); ?></th><th><?php esc_html_e( 'Action', 'avenra-halo-v2' ); ?></th></tr></thead><tbody>
			<?php if ( ! $reports ) : ?><tr><td colspan="5"><?php esc_html_e( 'No reports in this queue.', 'avenra-halo-v2' ); ?></td></tr><?php endif; ?>
			<?php foreach ( $reports as $report ) : ?>
				<tr><td><?php echo esc_html( $this->rfc3339( $report->created_at ) ?? '' ); ?></td><td><strong><?php echo esc_html( ucfirst( (string) $report->target_type ) ); ?></strong><br><code><?php echo esc_html( (string) $report->target_public_id ); ?></code><br><?php echo esc_html( $this->moderation_excerpt( (string) $report->target_type, (string) $report->target_public_id ) ); ?></td><td><?php echo esc_html( ucfirst( (string) $report->reason ) ); ?></td><td><?php echo esc_html( (string) $report->details ); ?></td><td>
					<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>"><input type="hidden" name="action" value="avenra_halo_community_moderate"><input type="hidden" name="report_id" value="<?php echo esc_attr( (string) $report->public_id ); ?>"><?php wp_nonce_field( 'avenra_halo_community_moderate_' . (string) $report->public_id ); ?><select name="moderation_action"><option value="reviewing"><?php esc_html_e( 'Mark reviewing', 'avenra-halo-v2' ); ?></option><option value="resolved"><?php esc_html_e( 'Resolve', 'avenra-halo-v2' ); ?></option><option value="dismissed"><?php esc_html_e( 'Dismiss', 'avenra-halo-v2' ); ?></option><option value="remove_content"><?php esc_html_e( 'Remove content', 'avenra-halo-v2' ); ?></option><option value="suspend_member"><?php esc_html_e( 'Suspend member', 'avenra-halo-v2' ); ?></option></select><input class="small-text" type="text" name="note" maxlength="500" placeholder="Internal note"><button class="button" type="submit"><?php esc_html_e( 'Apply', 'avenra-halo-v2' ); ?></button></form>
				</td></tr>
			<?php endforeach; ?>
			</tbody></table>
		</div>
		<?php
	}

	public function handle_moderation_action(): void {
		global $wpdb;
		if ( ! current_user_can( self::CAP_MODERATE ) ) {
			wp_die( esc_html__( 'You are not authorised to moderate Halo Community.', 'avenra-halo-v2' ), '', array( 'response' => 403 ) );
		}
		$report_id = isset( $_POST['report_id'] ) ? strtolower( sanitize_text_field( wp_unslash( $_POST['report_id'] ) ) ) : '';
		check_admin_referer( 'avenra_halo_community_moderate_' . $report_id );
		$action = isset( $_POST['moderation_action'] ) ? sanitize_key( wp_unslash( $_POST['moderation_action'] ) ) : '';
		$note = isset( $_POST['note'] ) ? $this->text_substr( sanitize_text_field( wp_unslash( $_POST['note'] ) ), 0, 500 ) : '';
		if ( ! in_array( $action, array( 'reviewing', 'resolved', 'dismissed', 'remove_content', 'suspend_member' ), true ) ) {
			wp_die( esc_html__( 'Invalid moderation action.', 'avenra-halo-v2' ), '', array( 'response' => 400 ) );
		}
		$report = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_reports' ) ) . '` WHERE public_id = %s LIMIT 1', $report_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( ! is_object( $report ) ) {
			wp_die( esc_html__( 'Report not found.', 'avenra-halo-v2' ), '', array( 'response' => 404 ) );
		}
		$report_lock = $this->db->acquire_advisory_lock( 'community-report', $report_id, 2 );
		if ( ! $report_lock ) {
			wp_die( esc_html__( 'This report is already being moderated. Reload and try again.', 'avenra-halo-v2' ), '', array( 'response' => 409 ) );
		}
		$profile_lock = null;
		if ( 'suspend_member' === $action || ( 'remove_content' === $action && 'profile' === (string) $report->target_type ) ) {
			$profile_lock = $this->db->acquire_advisory_lock( 'community-profile', (string) (int) $report->target_customer_id, 2 );
			if ( ! $profile_lock ) {
				$this->db->release_advisory_lock( $report_lock );
				wp_die( esc_html__( 'That Community profile is already being updated. Reload and try again.', 'avenra-halo-v2' ), '', array( 'response' => 409 ) );
			}
		}
		$now = current_time( 'mysql', true );
		$new_status = $action;
		$transaction_open = false;
		$committed = false;
		try {
			if ( false !== $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				$transaction_open = true;
				$mutation_ok = true;
				if ( 'remove_content' === $action ) {
					$mutation_ok = $this->moderate_remove_content( (string) $report->target_type, (string) $report->target_public_id, $now );
					$new_status = 'resolved';
				} elseif ( 'suspend_member' === $action ) {
					$updated = $wpdb->update( $this->db->table( 'community_profiles' ), array( 'status' => 'suspended', 'directory_visible' => 0, 'allow_dms' => 0, 'updated_at' => $now ), array( 'customer_id' => (int) $report->target_customer_id ) );
					$current = $this->profile_by_customer( (int) $report->target_customer_id );
					$mutation_ok = false !== $updated && is_object( $current ) && 'suspended' === (string) $current->status;
					$new_status = 'resolved';
				}
				$report_saved = $mutation_ok ? $wpdb->update( $this->db->table( 'community_reports' ), array( 'status' => $new_status, 'moderator_wp_user_id' => get_current_user_id(), 'resolution_note' => $note, 'resolved_at' => in_array( $new_status, array( 'resolved', 'dismissed' ), true ) ? $now : null, 'updated_at' => $now ), array( 'id' => (int) $report->id ) ) : false;
				$event_saved = false !== $report_saved ? $wpdb->insert( $this->db->table( 'community_moderation_events' ), array( 'report_id' => (int) $report->id, 'wp_user_id' => get_current_user_id(), 'action' => $action, 'metadata_json' => wp_json_encode( array( 'note_present' => '' !== $note ) ), 'created_at' => $now ) ) : false;
				if ( false !== $event_saved && false !== $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
					$transaction_open = false;
					$committed = true;
				}
			}
		} catch ( Throwable $error ) {
			$committed = false;
		} finally {
			if ( $transaction_open ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			}
			if ( $profile_lock ) {
				$this->db->release_advisory_lock( $profile_lock );
			}
			$this->db->release_advisory_lock( $report_lock );
		}
		if ( ! $committed ) {
			do_action( 'avenra_halo_v2_community_moderation_failed', array( 'report_id' => $report_id, 'action' => $action, 'request_id' => wp_generate_uuid4() ) );
			wp_die( esc_html__( 'The moderation action could not be committed safely. Reload the queue and verify its state before retrying.', 'avenra-halo-v2' ), '', array( 'response' => 503 ) );
		}
		wp_safe_redirect( add_query_arg( array( 'page' => self::ADMIN_SLUG, 'status' => $new_status ), admin_url( 'tools.php' ) ) );
		exit;
	}

	private function moderate_remove_content( string $type, string $public_id, string $now ): bool {
		global $wpdb;
		$map = array( 'thread' => 'community_threads', 'reply' => 'community_replies', 'message' => 'community_messages' );
		if ( 'profile' === $type ) {
			$profile = $this->profile_by_public_id( $public_id );
			if ( ! is_object( $profile ) ) {
				return false;
			}
			$updated = $wpdb->update( $this->db->table( 'community_profiles' ), array( 'bio' => '', 'directory_visible' => 0, 'allow_dms' => 0, 'status' => 'suspended', 'updated_at' => $now ), array( 'customer_id' => (int) $profile->customer_id ) );
			$current = $this->profile_by_customer( (int) $profile->customer_id );
			return false !== $updated && is_object( $current ) && 'suspended' === (string) $current->status && '' === (string) $current->bio;
		}
		if ( ! isset( $map[ $type ] ) ) {
			return false;
		}
		$table = $this->db->table( $map[ $type ] );
		$updated = $wpdb->update( $table, array( 'status' => 'removed', 'updated_at' => $now ), array( 'public_id' => $public_id ) );
		$status = $wpdb->get_var( $wpdb->prepare( 'SELECT status FROM `' . esc_sql( $table ) . '` WHERE public_id = %s LIMIT 1', $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return false !== $updated && 'removed' === (string) $status;
	}

	/** @return object|WP_Error */
	private function require_profile() {
		$profile = $this->profile_by_customer( $this->auth->customer_id() );
		return $this->profile_is_active( $profile ) ? $profile : new WP_Error( 'community_profile_required', __( 'Opt in and create a Community profile first.', 'avenra-halo-v2' ), array( 'status' => 403 ) );
	}

	private function storage_ready(): bool {
		foreach ( array( 'community_profiles', 'community_threads', 'community_replies', 'community_conversations', 'community_messages', 'community_blocks', 'community_reports', 'community_moderation_events' ) as $name ) {
			if ( ! $this->db->table_exists( $this->db->table( $name ) ) ) {
				return false;
			}
		}
		return true;
	}

	private function profile_by_customer( int $customer_id ): ?object {
		global $wpdb;
		if ( $customer_id < 1 || ! $this->db->table_exists( $this->db->table( 'community_profiles' ) ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_profiles' ) ) . '` WHERE customer_id = %d LIMIT 1', $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function profile_by_public_id( string $public_id ): ?object {
		global $wpdb;
		$public_id = strtolower( sanitize_text_field( $public_id ) );
		if ( ! preg_match( '/^[a-f0-9-]{36}$/', $public_id ) || ! $this->db->table_exists( $this->db->table( 'community_profiles' ) ) ) {
			return null;
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_profiles' ) ) . '` WHERE public_id = %s LIMIT 1', $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function profile_is_active( mixed $profile ): bool {
		return is_object( $profile )
			&& 'active' === (string) $profile->status
			&& '' !== trim( (string) $profile->username )
			&& hash_equals( self::TERMS_VERSION, (string) $profile->terms_version );
	}

	/** @return array<string,mixed> */
	private function own_profile( ?object $profile ): array {
		if ( ! is_object( $profile ) || ! $this->profile_is_active( $profile ) ) {
			return array( 'opted_in' => false, 'member_id' => is_object( $profile ) ? sanitize_text_field( (string) $profile->public_id ) : null, 'username' => null, 'bio' => '', 'allow_dms' => false, 'directory_visible' => false, 'status' => is_object( $profile ) ? sanitize_key( (string) $profile->status ) : 'not_joined' );
		}
		return array_merge( $this->public_profile( $profile ), array( 'opted_in' => true, 'directory_visible' => '1' === (string) $profile->directory_visible, 'status' => 'active', 'terms_version' => sanitize_text_field( (string) $profile->terms_version ) ) );
	}

	/** @return array<string,mixed> */
	private function public_profile( object $profile ): array {
		$active = $this->profile_is_active( $profile );
		return array(
			'member_id'  => sanitize_text_field( (string) $profile->public_id ),
			'username'   => $active ? sanitize_text_field( (string) $profile->username ) : __( 'Former member', 'avenra-halo-v2' ),
			'bio'        => $active ? sanitize_textarea_field( (string) $profile->bio ) : '',
			'allow_dms'  => $active && '1' === (string) $profile->allow_dms,
			'joined_at'  => $this->rfc3339( $profile->opted_in_at ?? $profile->created_at ?? null ),
		);
	}

	private function thread_by_public_id( string $public_id ): ?object {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_threads' ) ) . '` WHERE public_id = %s LIMIT 1', strtolower( sanitize_text_field( $public_id ) ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function thread_with_author( string $public_id ): ?object {
		global $wpdb;
		$threads = esc_sql( $this->db->table( 'community_threads' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT t.*, p.public_id AS author_public_id, p.username AS author_username, p.status AS author_status, p.terms_version AS author_terms_version FROM `{$threads}` t LEFT JOIN `{$profiles}` p ON p.customer_id = t.author_customer_id WHERE t.public_id = %s LIMIT 1", strtolower( sanitize_text_field( $public_id ) ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	/** @return array<string,mixed> */
	private function public_thread( ?object $row, bool $full ): array {
		if ( ! is_object( $row ) ) {
			return array();
		}
		$active_author = 'active' === (string) ( $row->author_status ?? '' )
			&& '' !== (string) ( $row->author_username ?? '' )
			&& hash_equals( self::TERMS_VERSION, (string) ( $row->author_terms_version ?? '' ) );
		return array(
			'thread_id'    => sanitize_text_field( (string) $row->public_id ),
			'title'        => sanitize_text_field( (string) $row->title ),
			'body'         => $full ? sanitize_textarea_field( (string) $row->body ) : $this->text_substr( sanitize_textarea_field( (string) $row->body ), 0, 280 ),
			'author'       => array( 'member_id' => $active_author ? sanitize_text_field( (string) $row->author_public_id ) : null, 'username' => $active_author ? sanitize_text_field( (string) $row->author_username ) : __( 'Former member', 'avenra-halo-v2' ) ),
			'reply_count'  => absint( $row->reply_count ?? 0 ),
			'locked'       => 'locked' === (string) $row->status,
			'can_edit'     => (int) $row->author_customer_id === $this->auth->customer_id() && 'active' === (string) $row->status,
			'created_at'   => $this->rfc3339( $row->created_at ?? null ),
			'updated_at'   => $this->rfc3339( $row->updated_at ?? null ),
			'last_activity_at' => $this->rfc3339( $row->last_activity_at ?? null ),
		);
	}

	private function reply_by_public_id( string $public_id ): ?object {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_replies' ) ) . '` WHERE public_id = %s LIMIT 1', strtolower( sanitize_text_field( $public_id ) ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function reply_with_author( string $public_id ): ?object {
		global $wpdb;
		$replies = esc_sql( $this->db->table( 'community_replies' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT r.*, p.public_id AS author_public_id, p.username AS author_username, p.status AS author_status, p.terms_version AS author_terms_version FROM `{$replies}` r LEFT JOIN `{$profiles}` p ON p.customer_id = r.author_customer_id WHERE r.public_id = %s LIMIT 1", strtolower( sanitize_text_field( $public_id ) ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	/** @return array<string,mixed> */
	private function public_reply( ?object $row ): array {
		if ( ! is_object( $row ) ) {
			return array();
		}
		$active_author = 'active' === (string) ( $row->author_status ?? '' )
			&& '' !== (string) ( $row->author_username ?? '' )
			&& hash_equals( self::TERMS_VERSION, (string) ( $row->author_terms_version ?? '' ) );
		return array(
			'reply_id'   => sanitize_text_field( (string) $row->public_id ),
			'body'       => sanitize_textarea_field( (string) $row->body ),
			'author'     => array( 'member_id' => $active_author ? sanitize_text_field( (string) $row->author_public_id ) : null, 'username' => $active_author ? sanitize_text_field( (string) $row->author_username ) : __( 'Former member', 'avenra-halo-v2' ) ),
			'can_edit'   => (int) $row->author_customer_id === $this->auth->customer_id() && 'active' === (string) $row->status,
			'created_at' => $this->rfc3339( $row->created_at ?? null ),
			'updated_at' => $this->rfc3339( $row->updated_at ?? null ),
		);
	}

	private function conversation_by_public_id( string $public_id ): ?object {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_conversations' ) ) . '` WHERE public_id = %s LIMIT 1', strtolower( sanitize_text_field( $public_id ) ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $row : null;
	}

	private function owned_conversation( string $public_id, int $customer_id ): ?object {
		$row = $this->conversation_by_public_id( $public_id );
		return is_object( $row ) && in_array( $customer_id, array( (int) $row->customer_low_id, (int) $row->customer_high_id ), true ) ? $row : null;
	}

	private function conversation_other_id( object $row, int $customer_id ): int {
		return (int) $row->customer_low_id === $customer_id ? (int) $row->customer_high_id : (int) $row->customer_low_id;
	}

	/** @return array<string,mixed> */
	private function public_conversation( object $row, int $customer_id ): array {
		global $wpdb;
		$other_id = $this->conversation_other_id( $row, $customer_id );
		if ( property_exists( $row, 'other_public_id' ) && null !== $row->other_public_id ) {
			$other = (object) array(
				'public_id'     => $row->other_public_id,
				'username'      => $row->other_username,
				'bio'           => $row->other_bio,
				'allow_dms'     => $row->other_allow_dms,
				'status'        => $row->other_status,
				'terms_version' => $row->other_terms_version,
				'opted_in_at'   => $row->other_opted_in_at,
				'created_at'    => $row->other_created_at,
			);
		} else {
			$other = $this->profile_by_customer( $other_id );
		}
		$last = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM `" . esc_sql( $this->db->table( 'community_messages' ) ) . "` WHERE conversation_id = %d AND status = 'sent' ORDER BY created_at DESC, id DESC LIMIT 1", (int) $row->id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$unread = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM `" . esc_sql( $this->db->table( 'community_messages' ) ) . "` WHERE conversation_id = %d AND recipient_customer_id = %d AND status = 'sent' AND read_at IS NULL", (int) $row->id, $customer_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return array(
			'conversation_id' => sanitize_text_field( (string) $row->public_id ),
			'member'          => is_object( $other ) ? $this->public_profile( $other ) : array( 'member_id' => null, 'username' => __( 'Former member', 'avenra-halo-v2' ), 'bio' => '', 'allow_dms' => false, 'joined_at' => null ),
			'blocked'         => $this->are_blocked( $customer_id, $other_id ),
			'unread_count'    => $unread,
			'last_message'    => is_object( $last ) ? array( 'message_id' => sanitize_text_field( (string) $last->public_id ), 'body' => $this->text_substr( sanitize_textarea_field( (string) $last->body ), 0, 160 ), 'mine' => (int) $last->sender_customer_id === $customer_id, 'created_at' => $this->rfc3339( $last->created_at ) ) : null,
			'last_message_at' => $this->rfc3339( $row->last_message_at ?? null ),
		);
	}

	/** @return array<string,mixed>|WP_Error */
	private function insert_message( object $conversation, mixed $input, int $sender_id ) {
		global $wpdb;
		$content = $this->plain_text( $input, 2000, 1, __( 'Message', 'avenra-halo-v2' ), true );
		if ( is_wp_error( $content ) ) {
			return $content;
		}
		$recipient_id = $this->conversation_other_id( $conversation, $sender_id );
		$now = current_time( 'mysql', true );
		$public_id = wp_generate_uuid4();
		$messages = esc_sql( $this->db->table( 'community_messages' ) );
		$conversations = esc_sql( $this->db->table( 'community_conversations' ) );
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$blocks = esc_sql( $this->db->table( 'community_blocks' ) );
		$transaction_open = false;
		$committed = false;
		$state_changed = false;
		try {
			if ( false !== $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				$transaction_open = true;
				$saved = $wpdb->query(
					$wpdb->prepare(
						"INSERT INTO `{$messages}` (public_id,conversation_id,sender_customer_id,recipient_customer_id,body,status,created_at,updated_at) SELECT %s,c.id,sp.customer_id,rp.customer_id,%s,'sent',%s,%s FROM `{$conversations}` c INNER JOIN `{$profiles}` sp ON sp.customer_id = %d INNER JOIN `{$profiles}` rp ON rp.customer_id = %d WHERE c.id = %d AND ((c.customer_low_id = sp.customer_id AND c.customer_high_id = rp.customer_id) OR (c.customer_low_id = rp.customer_id AND c.customer_high_id = sp.customer_id)) AND sp.status = 'active' AND sp.terms_version = %s AND sp.username IS NOT NULL AND sp.username <> '' AND rp.status = 'active' AND rp.terms_version = %s AND rp.username IS NOT NULL AND rp.username <> '' AND rp.allow_dms = 1 AND NOT EXISTS (SELECT 1 FROM `{$blocks}` b WHERE (b.blocker_customer_id = sp.customer_id AND b.blocked_customer_id = rp.customer_id) OR (b.blocker_customer_id = rp.customer_id AND b.blocked_customer_id = sp.customer_id)) LIMIT 1", // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
						$public_id,
						$content,
						$now,
						$now,
						$sender_id,
						$recipient_id,
						(int) $conversation->id,
						self::TERMS_VERSION,
						self::TERMS_VERSION
					)
				);
				if ( 1 === (int) $saved ) {
					$updated = $wpdb->update( $this->db->table( 'community_conversations' ), array( 'last_message_at' => $now, 'updated_at' => $now ), array( 'id' => (int) $conversation->id ) );
					if ( false !== $updated && false !== $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
						$transaction_open = false;
						$committed = true;
					}
				} elseif ( false !== $saved ) {
					$state_changed = true;
				}
			}
		} catch ( Throwable $error ) {
			$committed = false;
		} finally {
			if ( $transaction_open ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			}
		}
		if ( ! $committed ) {
			return $state_changed
				? new WP_Error( 'community_message_state_changed', __( 'The member, direct-message or block state changed before the message could be sent.', 'avenra-halo-v2' ), array( 'status' => 409 ) )
				: new WP_Error( 'community_message_failed', __( 'The message could not be sent.', 'avenra-halo-v2' ), array( 'status' => 503 ) );
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM `' . esc_sql( $this->db->table( 'community_messages' ) ) . '` WHERE public_id = %s LIMIT 1', $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return is_object( $row ) ? $this->public_message( $row, $sender_id ) : new WP_Error( 'community_message_failed', __( 'The message could not be refreshed.', 'avenra-halo-v2' ), array( 'status' => 503 ) );
	}

	/** @return array<string,mixed> */
	private function public_message( object $row, int $viewer_id ): array {
		$sender = $this->profile_by_customer( (int) $row->sender_customer_id );
		return array(
			'message_id' => sanitize_text_field( (string) $row->public_id ),
			'body'       => sanitize_textarea_field( (string) $row->body ),
			'mine'       => (int) $row->sender_customer_id === $viewer_id,
			'sender'     => is_object( $sender ) ? $this->public_profile( $sender ) : array( 'member_id' => null, 'username' => __( 'Former member', 'avenra-halo-v2' ) ),
			'created_at' => $this->rfc3339( $row->created_at ?? null ),
			'read_at'    => $this->rfc3339( $row->read_at ?? null ),
		);
	}

	/** @return int[] */
	private function blocked_customer_ids( int $customer_id ): array {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT blocker_customer_id, blocked_customer_id FROM `' . esc_sql( $this->db->table( 'community_blocks' ) ) . '` WHERE blocker_customer_id = %d OR blocked_customer_id = %d', $customer_id, $customer_id ), ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$ids = array();
		foreach ( (array) $rows as $row ) {
			$ids[] = (int) $row['blocker_customer_id'] === $customer_id ? (int) $row['blocked_customer_id'] : (int) $row['blocker_customer_id'];
		}
		return array_values( array_unique( array_filter( $ids ) ) );
	}

	private function are_blocked( int $left, int $right ): bool {
		global $wpdb;
		if ( $left < 1 || $right < 1 || $left === $right ) {
			return false;
		}
		return (int) $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM `' . esc_sql( $this->db->table( 'community_blocks' ) ) . '` WHERE (blocker_customer_id = %d AND blocked_customer_id = %d) OR (blocker_customer_id = %d AND blocked_customer_id = %d) LIMIT 1', $left, $right, $right, $left ) ) > 0; // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	private function member_pair_identifier( int $left, int $right ): string {
		return min( $left, $right ) . '|' . max( $left, $right );
	}

	private function dm_interaction_allowed( int $sender_id, int $recipient_id, bool $require_directory ): bool {
		global $wpdb;
		if ( $sender_id < 1 || $recipient_id < 1 || $sender_id === $recipient_id ) {
			return false;
		}
		$profiles = esc_sql( $this->db->table( 'community_profiles' ) );
		$blocks = esc_sql( $this->db->table( 'community_blocks' ) );
		$directory = $require_directory ? ' AND rp.directory_visible = 1' : '';
		$sql = "SELECT 1 FROM `{$profiles}` sp INNER JOIN `{$profiles}` rp ON rp.customer_id = %d WHERE sp.customer_id = %d AND sp.status = 'active' AND sp.terms_version = %s AND sp.username IS NOT NULL AND sp.username <> '' AND rp.status = 'active' AND rp.terms_version = %s AND rp.username IS NOT NULL AND rp.username <> '' AND rp.allow_dms = 1{$directory} AND NOT EXISTS (SELECT 1 FROM `{$blocks}` b WHERE (b.blocker_customer_id = sp.customer_id AND b.blocked_customer_id = rp.customer_id) OR (b.blocker_customer_id = rp.customer_id AND b.blocked_customer_id = sp.customer_id)) LIMIT 1";
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( $sql, $recipient_id, $sender_id, self::TERMS_VERSION, self::TERMS_VERSION ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	/** @return array{customer_id:int}|WP_Error */
	private function report_target( string $type, string $public_id, int $reporter_id ) {
		global $wpdb;
		if ( 'profile' === $type ) {
			$profile = $this->profile_by_public_id( $public_id );
			return is_object( $profile ) ? array( 'customer_id' => (int) $profile->customer_id ) : new WP_Error( 'community_report_target_missing', __( 'That report target is unavailable.', 'avenra-halo-v2' ) );
		}
		$map = array( 'thread' => array( 'community_threads', 'author_customer_id' ), 'reply' => array( 'community_replies', 'author_customer_id' ) );
		if ( isset( $map[ $type ] ) ) {
			$row = $wpdb->get_row( $wpdb->prepare( 'SELECT ' . esc_sql( $map[ $type ][1] ) . ' AS customer_id FROM `' . esc_sql( $this->db->table( $map[ $type ][0] ) ) . '` WHERE public_id = %s LIMIT 1', $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			return is_object( $row ) ? array( 'customer_id' => (int) $row->customer_id ) : new WP_Error( 'community_report_target_missing', __( 'That report target is unavailable.', 'avenra-halo-v2' ) );
		}
		if ( 'message' === $type ) {
			$row = $wpdb->get_row( $wpdb->prepare( 'SELECT sender_customer_id, recipient_customer_id FROM `' . esc_sql( $this->db->table( 'community_messages' ) ) . '` WHERE public_id = %s LIMIT 1', $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( ! is_object( $row ) || ! in_array( $reporter_id, array( (int) $row->sender_customer_id, (int) $row->recipient_customer_id ), true ) ) {
				return new WP_Error( 'community_report_target_missing', __( 'That report target is unavailable.', 'avenra-halo-v2' ) );
			}
			return array( 'customer_id' => (int) $row->sender_customer_id );
		}
		return new WP_Error( 'community_report_target_missing', __( 'That report target is unavailable.', 'avenra-halo-v2' ) );
	}

	private function moderation_excerpt( string $type, string $public_id ): string {
		global $wpdb;
		if ( 'profile' === $type ) {
			$profile = $this->profile_by_public_id( $public_id );
			return is_object( $profile ) ? $this->text_substr( (string) $profile->bio, 0, 180 ) : '';
		}
		$map = array( 'thread' => array( 'community_threads', 'body' ), 'reply' => array( 'community_replies', 'body' ), 'message' => array( 'community_messages', 'body' ) );
		if ( ! isset( $map[ $type ] ) ) {
			return '';
		}
		$value = $wpdb->get_var( $wpdb->prepare( 'SELECT ' . esc_sql( $map[ $type ][1] ) . ' FROM `' . esc_sql( $this->db->table( $map[ $type ][0] ) ) . '` WHERE public_id = %s LIMIT 1', $public_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return $this->text_substr( sanitize_textarea_field( (string) $value ), 0, 180 );
	}

	/** @return string|WP_Error */
	private function username( mixed $input ) {
		$value = strtolower( remove_accents( trim( sanitize_text_field( (string) $input ) ) ) );
		if ( ! preg_match( '/^[a-z0-9][a-z0-9._-]{2,23}$/', $value ) || str_contains( $value, '..' ) || str_contains( $value, '__' ) || str_contains( $value, '--' ) ) {
			return new WP_Error( 'community_username_invalid', __( 'Use 3–24 letters, numbers, dots, underscores or hyphens for your public username.', 'avenra-halo-v2' ) );
		}
		$reserved = array( 'admin', 'administrator', 'avenra', 'avenrà', 'halo', 'support', 'moderator', 'official', 'emergency', 'deleted', 'former-member' );
		if ( in_array( $value, $reserved, true ) || str_starts_with( $value, 'avenra-' ) || str_starts_with( $value, 'halo-' ) ) {
			return new WP_Error( 'community_username_reserved', __( 'Choose a different public username.', 'avenra-halo-v2' ) );
		}
		return $value;
	}

	/** @return string|WP_Error */
	private function plain_text( mixed $input, int $max, int $min, string $label, bool $multiline ) {
		$value = trim( (string) $input );
		if ( str_contains( $value, '<' ) || str_contains( $value, '>' ) || wp_strip_all_tags( $value ) !== $value ) {
			return new WP_Error( 'community_html_not_allowed', sprintf( __( '%s cannot contain HTML.', 'avenra-halo-v2' ), $label ) );
		}
		$value = $multiline ? sanitize_textarea_field( $value ) : sanitize_text_field( $value );
		$length = $this->text_length( $value );
		if ( $length < $min || $length > $max ) {
			return new WP_Error( 'community_text_length', sprintf( __( '%1$s must be between %2$d and %3$d characters.', 'avenra-halo-v2' ), $label, $min, $max ) );
		}
		return $value;
	}

	/** @return array<string,mixed> */
	private function body( WP_REST_Request $request ): array {
		$body = $request->get_json_params();
		return is_array( $body ) ? $body : array();
	}

	/** @return array{int,int,int} */
	private function pagination( WP_REST_Request $request, int $default = 24 ): array {
		$page = max( 1, min( 500, absint( $request->get_param( 'page' ) ) ?: 1 ) );
		$per_page = max( 5, min( 50, absint( $request->get_param( 'per_page' ) ) ?: $default ) );
		return array( $page, $per_page, ( $page - 1 ) * $per_page );
	}

	/** @return array<string,int> */
	private function page_meta( int $page, int $per_page, int $total ): array {
		return array( 'page' => $page, 'per_page' => $per_page, 'total' => $total, 'total_pages' => max( 1, (int) ceil( $total / $per_page ) ) );
	}

	/** @param int[] $ids */
	private function not_in_clause( string $column, array $ids ): string {
		$ids = array_values( array_unique( array_filter( array_map( 'absint', $ids ) ) ) );
		return $ids ? ' AND ' . $column . ' NOT IN (' . implode( ',', $ids ) . ')' : '';
	}

	private function limit( string $scope, string $identifier, int $limit, int $window ): bool {
		return $this->db->consume_rate_limit( $scope, $identifier, max( 1, $limit ), max( MINUTE_IN_SECONDS, $window ) );
	}

	private function truthy( mixed $value ): bool {
		return true === $value || in_array( strtolower( trim( (string) $value ) ), array( '1', 'true', 'yes', 'on' ), true );
	}

	private function text_length( string $value ): int {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $value, 'UTF-8' ) : strlen( $value );
	}

	private function text_substr( string $value, int $start, int $length ): string {
		return function_exists( 'mb_substr' ) ? mb_substr( $value, $start, $length, 'UTF-8' ) : substr( $value, $start, $length );
	}

	private function rfc3339( mixed $value ): ?string {
		if ( null === $value || '' === trim( (string) $value ) || str_starts_with( (string) $value, '0000-00-00' ) ) {
			return null;
		}
		$time = strtotime( (string) $value . ( preg_match( '/(?:Z|[+-]\d{2}:?\d{2})$/', (string) $value ) ? '' : ' UTC' ) );
		return false === $time ? null : gmdate( DATE_RFC3339, $time );
	}

	/** @param array<string,mixed> $details */
	private function error( string $code, string $message, int $status, array $details = array() ): WP_REST_Response {
		return Avenra_Halo_V2_Response::error( $code, $message, $status, $details );
	}

	private function from_error( WP_Error $error, int $fallback ): WP_REST_Response {
		$data = $error->get_error_data();
		$status = is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : $fallback;
		return $this->error( (string) $error->get_error_code(), $error->get_error_message(), $status );
	}
}
