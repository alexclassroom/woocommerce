<?php

namespace Automattic\WooCommerce\Templating;

use \Closure;

class TemplateRenderingContext
{
	private TemplatingEngine $engine;
	private string $template_file_path;
	private array $variables;
	private Closure $render_subtemplate_callback;
	private array $blocks = [];
	private ?string $current_block_name = null;
	private string $template_display_name;

	public function __construct(Closure $render_subtemplate_callback, string $template_file_path, array $variables, array $blocks)
	{
		$this->render_subtemplate_callback = $render_subtemplate_callback;
		$this->template_file_path = $template_file_path;
		$this->variables = $variables;
		$this->blocks = $blocks;

		$this->template_display_name = pathinfo($template_file_path, PATHINFO_FILENAME);
	}

	public function get_template_display_name() {
		return $this->template_display_name;
	}

	public function set_template_display_name($name) {
		$this->template_display_name = $name;
	}

	public function has_variable($name): bool {
		return array_key_exists($name, $this->variables);
	}

	public function __get($name) {
		return $this->variables[$name] ?? null;
	}

	public function render(string $template_name, array $variables = [], bool $relative = true) {
		$variables = array_merge($this->variables, $variables);
		($this->render_subtemplate_callback)($template_name, $variables, $this->blocks, $relative);
	}

	public function add_block(string $name, string $contents) {
		$this->blocks[$name] = $contents;
	}

	public function start_block(string $name) {
		if(!is_null($this->current_block_name)) {
			throw new \Exception("Blocks can't be nested, currently defining block {$this->current_block_name} in template {$this->template_display_name}");
		}
		$this->current_block_name = $name;
		ob_start();
	}

	public function end_block() {
		$this->blocks[$this->current_block_name] = ob_get_clean();
		$this->current_block_name = null;
	}

	public function render_block($name) {
		if(!array_key_exists($name, $this->blocks)) {
			throw new \Exception("Undefined block {$name} rendering template {$this->template_display_name}");
		}
		echo $this->blocks[$name];
	}

	public function get_name_of_block_being_defined() {
		return $this->current_block_name;
	}
}
