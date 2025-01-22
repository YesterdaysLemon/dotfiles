local wezterm = require("wezterm")
local config = wezterm.config_builder()

config.color_scheme = "Monokai Pro (Gogh)"

config.hide_tab_bar_if_only_one_tab = true
config.exit_behavior = "Close"

config.window_padding = {
	left = 10,
	right = 10,
	top = 10,
	bottom = 10,
}

--window
config.window_decorations = "RESIZE"
config.inactive_pane_hsb = {
	saturation = 0.9,
	brightness = 0.8,
}
--fonts
config.font_size = 16
config.line_height = 1.2

return config
