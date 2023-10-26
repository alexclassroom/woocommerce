<?php

namespace Automattic\WooCommerce\Templating;

use Automattic\WooCommerce\Utilities\StringUtil;

class TemplatingEngine
{
	private string $default_templates_directory;

	public function __construct() {
		$this->default_templates_directory = __DIR__ . '/Templates';
	}

	public static function do_render_template( string $template_name, array $variables, ?array $metadata = null): ?string {
		return wc_get_container()->get(TemplatingEngine::class)->render_template($template_name, $variables, $metadata);
	}

	public static function do_get_rendered_file_by_id(int $id, bool $include_metadata = false): ?array {
		return wc_get_container()->get(TemplatingEngine::class)->get_rendered_file_by_id($id, $include_metadata);
	}

	public static function do_get_rendered_file_by_name(string $file_name, bool $include_metadata = false): ?array {
		return wc_get_container()->get(TemplatingEngine::class)->get_rendered_file_by_name($file_name, $include_metadata);
	}

	public static function do_delete_rendered_file_by_id( int $id): bool {
		return wc_get_container()->get(TemplatingEngine::class)->delete_rendered_file_by_id($id);
	}

	public static function do_delete_rendered_file_by_name( string $name): bool {
		return wc_get_container()->get(TemplatingEngine::class)->delete_rendered_file_by_name($name);
	}

	public function render_template( string $template_name, array $variables, ?array $metadata = null ): ?string {
		global $wpdb;

		$render_to_file = !is_null($metadata);
		$rendering_callback = null;
		$render_ok = false;

		if($render_to_file) {
			$metadata = apply_filters('woocommerce_rendered_template_metadata', $metadata, $template_name, $variables);

			if(array_key_exists('expiration_date', $metadata)) {
				$expiration_date = $metadata['expiration_date'];
				if(is_numeric($expiration_date)) {
					$expiration_date = date('Y-m-d H:i:s', $expiration_date);
				}
				else if(!is_string($expiration_date) || !StringUtil::is_valid_date($expiration_date)) {
					throw new \Exception("$expiration_date is not a valid date, expected format: year-month-day hour:minute:second");
				}
				unset($metadata['expiration_date']);
			}
			else if(array_key_exists('expiration_seconds', $metadata)) {
				$expiration_seconds = $metadata['expiration_seconds'];
				if(!is_numeric($expiration_seconds) || (int)$expiration_seconds < 60) {
					throw new \Exception("expiration_seconds must be a number and have a minimum value of 60");
				}
				$now_gmt = current_time('mysql', true);
				$expiration_date = date( 'Y-m-d H:i:s', strtotime( $now_gmt ) + (int)$expiration_seconds );
				unset($metadata['expiration_seconds']);
			}
			else {
				throw new \Exception("The metadata array must have either an expiration_date key or an expiration_seconds key");
			}

			$is_public = (bool)$metadata['is_public'] ?? false;
			unset($metadata['is_public']);

			$filename = bin2hex(random_bytes(16));
			$filename = apply_filters( 'woocommerce_rendered_template_filename', $filename, $template_name, $variables, $metadata );
			$rendered_files_directory = $this->get_rendered_files_directory();
			$rendered_files_directory .= '/' . current_time('Y-m', true);
			if(!is_dir($rendered_files_directory)) {
				mkdir($rendered_files_directory, 0777, true);
			}
			$filepath = $rendered_files_directory . '/' . $filename;

			$file_handle = fopen($filepath, 'w');
			if(!$file_handle) {
				throw new \Exception("Can't create file to render template $template_name");
			}

			$rendering_callback = function($data,$flags) use ($file_handle) {
				fwrite($file_handle, $data);
				return null;
			};
		}

		ob_start($rendering_callback);
		try {
			$this->render_template_core($template_name, $variables, [], null, false);
			if(!$render_to_file) {
				return ob_end_flush();
			}

			ob_end_flush();
			fclose($file_handle);
			$render_ok = true;
		}
		finally {
			if(ob_get_level()>0) {
				ob_end_clean();
			}
			if(!$render_ok && $render_to_file) {
				unlink($filepath);
			}
		}

		$query_ok = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$wpdb->prefix}wc_rendered_templates (file_name, date_created_gmt, expiration_date_gmt, is_public) VALUES (%s, %s, %s, %d)",
				$filename, current_time('mysql', true), $expiration_date, $is_public
			)
		);

		$db_error = $wpdb->last_error;
		if($query_ok !== false && !empty($metadata)) {
			$metadata_args_template = [];
			$metadata_args = [];
			$inserted_id = $wpdb->insert_id;

			foreach($metadata as $metadata_key => $metadata_value) {
				$metadata_args_template[] = '(%d, %s, %s)';
				$metadata_args[] = $inserted_id;
				$metadata_args[] = $metadata_key;
				$metadata_args[] = $metadata_value;
			}

			$metadata_args_template_sql = join(',', $metadata_args_template);

			$query_ok = $wpdb->query(
				$wpdb->prepare(
					"INSERT INTO {$wpdb->prefix}wc_rendered_templates_meta (rendered_template_id, meta_key, meta_value) VALUES $metadata_args_template_sql",
					$metadata_args
				)
			);

			if(false === $query_ok) {
				$db_error = $wpdb->last_error;
				$wpdb->delete("{$wpdb->prefix}wc_rendered_templates", ['id' => $inserted_id], ['id' => '%d']);
			}
		}

		if(false === $query_ok) {
			unlink($filepath);
			throw new \Exception("Error inserting rendered template info in the database: $db_error");
		}

		return $filename;
	}

	public function get_rendered_files_directory(): string {
		$rendered_templates_directory = wp_upload_dir()['basedir'] . '/woocommerce_rendered_templates';
		$rendered_templates_directory = apply_filters('woocommerce_rendered_templates_directory', $rendered_templates_directory);
		$realpathed_rendered_templates_directory = realpath($rendered_templates_directory);
		if(false === $realpathed_rendered_templates_directory) {
			throw new \Exception("The base rendered templates directory doesn't exist: $rendered_templates_directory");
		}

		return untrailingslashit($realpathed_rendered_templates_directory);
	}

	private function render_template_core(string $template_name, array $variables, array $blocks, ?string $parent_template_path, bool $relative): void {
		$template_directory = ($relative && !is_null($parent_template_path)) ? dirname($parent_template_path) : $this->default_templates_directory;
		$template_path = $template_directory . '/' . $template_name . ( is_null(pathinfo($template_name)['extension']) ? '.template' : '');
		$template_path = realpath($template_path);
		if(false === $template_path || strpos($template_path, $template_directory . DIRECTORY_SEPARATOR) !== 0) {
			$template_path = null;
		}
		$template_path = apply_filters('woocommerce_template_file_path', $template_path, $template_name, $relative ? $parent_template_path : null);
		if(is_null($template_path)) {
			throw new \Exception("Template not found: $template_name");
		}

		$render_subtemplate_callbak =
			fn($sub_template_name, $sub_variables, $blocks, $relative)
			=> $this->render_template_core($sub_template_name, $sub_variables, $blocks, $template_path, $relative);
		$context = new TemplateRenderingContext($render_subtemplate_callbak, $template_path, $variables, $blocks);
		$include_template_file = (fn() => include($template_path))->bindTo($context);
		$include_template_file();

		$unclosed_block_name = $context->get_name_of_block_being_defined();
		if(!is_null($unclosed_block_name)) {
			throw new \Exception("Unclosed block: $unclosed_block_name, rendering {$context->get_template_display_name()}");
		}
	}

	public function get_rendered_file_by_id(int $id, bool $include_metadata = false): ?array {
		global $wpdb;

		$sql_query =
			$wpdb->prepare(
				"SELECT id, file_name as file_path, date_created_gmt, expiration_date_gmt, is_public FROM {$wpdb->prefix}wc_rendered_templates WHERE id=%d",
				$id
			);

		return $this->get_rendered_file_core( $sql_query, $include_metadata);
	}

	public function get_rendered_file_by_name(string $file_name, bool $include_metadata = false): ?array {
		global $wpdb;

		$sql_query =
			$wpdb->prepare(
				"SELECT id, file_name as file_path, date_created_gmt, expiration_date_gmt, is_public FROM {$wpdb->prefix}wc_rendered_templates WHERE file_name=%s",
				$file_name
			);

		return $this->get_rendered_file_core( $sql_query, $include_metadata);
	}

	private function get_rendered_file_core(string $sql_query, bool $include_metadata): ?array {
		global $wpdb;

		$data = $wpdb->get_row($sql_query, ARRAY_A);
		if(empty($data)) {
			return null;
		}

		$data['file_path'] = $this->get_rendered_files_directory() . '/' . substr($data['created_gmt'], 0, 7) . '/' . $data['file_path'];
		$data['is_public'] = (bool)$data['is_public'];
		$data['has_expired'] = strtotime($data['expiration_date_gmt']) < current_time('timestamp', true);

		if(!$include_metadata) {
			return $data;
		}

		$metadata = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT meta_key, meta_value FROM {$wpdb->prefix}wc_rendered_templates_meta WHERE rendered_template_id=%d",
				$data['id']
			),
			OBJECT_K
		);
		$data['metadata'] = array_map(fn($value) => $value->meta_value, $metadata);

		return $data;
	}

	public function delete_rendered_file_by_id(int $id): bool {
		global $wpdb;

		$result = $wpdb->delete("{$wpdb->prefix}wc_rendered_templates", ['id' => $id], ['id' => '%d']);
		if(false === $result) {
			throw new \Exception("Error deleting template with id $id: {$wpdb->last_error}");
		}

		$meta_result = $wpdb->delete("{$wpdb->prefix}wc_rendered_templates_meta", ['rendered_template_id' => $id], ['id' => '%d']);
		if(false === $meta_result) {
			throw new \Exception("Error deleting metadata for template with id $id: {$wpdb->last_error}");
		}

		return $result > 0;
	}

	public function delete_rendered_file_by_name(string $name): bool {
		global $wpdb;

		$id = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM {$wpdb->prefix}wc_rendered_templates WHERE file_name=%s",
				$name
			)
		);
		if(is_null($id)) {
			return false;
		}

		return $this->delete_rendered_file_by_id($id);
	}

	public function delete_expired_rendered_files(?string $expiration_date_gmt=null, int $limit=1000): int {
		global $wpdb;

		$expiration_date_gmt ??= current_time('mysql', true);

		$meta_result = $wpdb->get_var(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->prefix}wc_rendered_templates_meta WHERE rendered_template_id in (
					SELECT id FROM {$wpdb->prefix}wc_rendered_templates WHERE $expiration_date_gmt<%s ORDER BY expiration_date_gmt LIMIT $limit)",
				$expiration_date_gmt
			)
		);
		if(false === $meta_result) {
			throw new \Exception("Error deleting metadata for templates expired as of $expiration_date_gmt GMT: {$wpdb->last_error}");
		}

		$result = $wpdb->get_var(
			$wpdb->prepare(
				"DELETE FROM {$wpdb->prefix}wc_rendered_templates WHERE id in (
					SELECT id FROM {$wpdb->prefix}wc_rendered_templates WHERE $expiration_date_gmt<%s ORDER BY expiration_date_gmt LIMIT $limit)",
				$expiration_date_gmt
			)
		);

		if(false === $result) {
			throw new \Exception("Error deleting templates expired as of $expiration_date_gmt GMT: {$wpdb->last_error}");
		}

		return $result;
	}
}
