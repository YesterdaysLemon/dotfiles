local wezterm = require("wezterm")
local act = wezterm.action
local config = wezterm.config_builder()

--colors
-- local scheme_name = "Monokai Pro (Gogh)"
-- local scheme_name = "Gogh (Gogh)"
-- local scheme_name = "Gruvbox (Gogh)"
local scheme_name = "Gruvbox dark, hard (base16)"
-- local scheme_name = "Gruvbox Material (Gogh)"

-- gruvbox palette for the tab bar and status
local gb = {
	bg0_h = "#1d2021",
	bg1 = "#3c3836",
	fg = "#ebdbb2",
	gray = "#928374",
	yellow = "#fabd2f",
	blue = "#83a598",
}

-- the built-in scheme plus a matching tab bar
local scheme = wezterm.color.get_builtin_schemes()[scheme_name]
scheme.tab_bar = {
	background = gb.bg0_h,
	active_tab = { bg_color = gb.bg1, fg_color = gb.yellow, intensity = "Bold" },
	inactive_tab = { bg_color = gb.bg0_h, fg_color = gb.gray },
	inactive_tab_hover = { bg_color = gb.bg1, fg_color = gb.fg },
	new_tab = { bg_color = gb.bg0_h, fg_color = gb.gray },
	new_tab_hover = { bg_color = gb.bg1, fg_color = gb.fg },
}
config.color_schemes = { ["Lemon"] = scheme }
config.color_scheme = "Lemon"

config.hide_tab_bar_if_only_one_tab = true
config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.tab_max_width = 32
config.show_new_tab_button_in_tab_bar = false
config.exit_behavior = "Close"
config.adjust_window_size_when_changing_font_size = false

config.window_padding = {
	left = 10,
	right = 10,
	top = 10,
	bottom = 10,
}

--window
config.window_decorations = "RESIZE"
config.window_background_opacity = 0.94
config.macos_window_background_blur = 24
config.initial_cols = 120
config.initial_rows = 34
config.inactive_pane_hsb = {
	saturation = 0.9,
	brightness = 0.8,
}
config.max_fps = 120
config.scrollback_lines = 20000

--fonts
config.font = wezterm.font_with_fallback({ "JetBrains Mono", "Symbols Nerd Font Mono" })
config.font_size = 19
config.line_height = 1.2

--cursor
config.default_cursor_style = "BlinkingBar"
config.cursor_blink_rate = 600
config.cursor_blink_ease_in = "Constant"
config.cursor_blink_ease_out = "Constant"

--bell: no beep, a soft flash, and a notification when the window is in the background
config.audible_bell = "Disabled"
config.visual_bell = {
	fade_in_duration_ms = 75,
	fade_out_duration_ms = 150,
	target = "CursorColor",
}
config.notification_handling = "SuppressFromFocusedWindow"

wezterm.on("bell", function(window, pane)
	if not window:is_focused() then
		window:toast_notification("WezTerm", pane:get_title() .. " wants your attention", nil, 4000)
	end
end)

--keys
-- left option acts as meta (for claude and zsh shortcuts), right option still types special characters
config.send_composed_key_when_left_alt_is_pressed = false
config.send_composed_key_when_right_alt_is_pressed = true

local claude = wezterm.home_dir .. "/.local/bin/claude"
local herdr = wezterm.home_dir .. "/.local/bin/herdr"

config.keys = {
	-- splits, iTerm style
	{ key = "d", mods = "CMD", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
	{ key = "d", mods = "CMD|SHIFT", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },
	{ key = "w", mods = "CMD", action = act.CloseCurrentPane({ confirm = true }) },
	{ key = "Enter", mods = "CMD|SHIFT", action = act.TogglePaneZoomState },
	{ key = "LeftArrow", mods = "CMD|OPT", action = act.ActivatePaneDirection("Left") },
	{ key = "RightArrow", mods = "CMD|OPT", action = act.ActivatePaneDirection("Right") },
	{ key = "UpArrow", mods = "CMD|OPT", action = act.ActivatePaneDirection("Up") },
	{ key = "DownArrow", mods = "CMD|OPT", action = act.ActivatePaneDirection("Down") },

	-- claude in a split to the right, in the same folder; drops back to a shell when it exits
	{
		key = "c",
		mods = "CMD|SHIFT",
		action = act.SplitPane({
			direction = "Right",
			size = { Percent = 55 },
			command = { args = { "/bin/zsh", "-l", "-c", claude .. "; exec /bin/zsh -l" } },
		}),
	},

	-- herdr (agent workspaces) in a new tab; ctrl+b q detaches and it keeps running
	{
		key = "h",
		mods = "CMD|SHIFT",
		action = act.SpawnCommandInNewTab({ args = { "/bin/zsh", "-l", "-c", herdr .. "; exec /bin/zsh -l" } }),
	},

	-- shift+enter is a newline in claude
	{ key = "Enter", mods = "SHIFT", action = act.SendString("\x1b\r") },

	-- mac-style line editing
	{ key = "LeftArrow", mods = "OPT", action = act.SendString("\x1bb") },
	{ key = "RightArrow", mods = "OPT", action = act.SendString("\x1bf") },
	{ key = "LeftArrow", mods = "CMD", action = act.SendString("\x01") },
	{ key = "RightArrow", mods = "CMD", action = act.SendString("\x05") },
	{ key = "Backspace", mods = "CMD", action = act.SendString("\x15") },
}

--tab titles: index, a mark for claude tabs, then the pane title
local function tab_title(tab)
	local title = tab.tab_title
	if title == nil or title == "" then
		title = tab.active_pane.title
	end
	return title
end

wezterm.on("format-tab-title", function(tab, _, _, _, _, max_width)
	local title = tab_title(tab)
	local proc = tab.active_pane.foreground_process_name or ""
	local mark = ""
	if title:find("Claude") or proc:find("/claude/") then
		mark = "✳ "
	end
	local text = " " .. (tab.tab_index + 1) .. " " .. mark .. title .. " "
	return wezterm.truncate_right(text, max_width)
end)

--right status: folder and clock (shows whenever the tab bar is visible)
wezterm.on("update-status", function(window, pane)
	local cwd = ""
	local url = pane:get_current_working_dir()
	if url and url.file_path then
		cwd = url.file_path:gsub("/$", "")
		local home = wezterm.home_dir
		if cwd:sub(1, #home) == home then
			cwd = "~" .. cwd:sub(#home + 1)
		end
	end
	window:set_right_status(wezterm.format({
		{ Foreground = { Color = gb.blue } },
		{ Text = cwd .. "  " },
		{ Foreground = { Color = gb.gray } },
		{ Text = wezterm.strftime("%H:%M") .. " " },
	}))
end)

return config
