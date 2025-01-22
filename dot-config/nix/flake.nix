{
  description = "lemon's nix-darwin system flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin = {
      url = "github:LnL7/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs@{ self, nix-darwin, nixpkgs }:
  let
    configuration = { pkgs, ... }: {
      # List packages installed in system profile. To search by name, run:
      # $ nix-env -qaP | grep wget
      environment.systemPackages =
        [ 
          pkgs.neofetch
          pkgs.neovim
          pkgs.stow
          pkgs.wezterm
          pkgs.devbox
	  pkgs.fzf
        ];
      fonts.packages = 
        [
          pkgs.nerd-fonts.jetbrains-mono
        ];
      homebrew = {
        enable = true;
        onActivation.cleanup = "uninstall";
        taps = [];
        brews = ["cowsay" "fzf"];
        casks = ["vlc" "raycast" "hiddenbar"];
      };
      users.users.lemon = {
          name = "lemon";
          home = "/Users/lemon";
        };
      # allows for touchid
      security.pam.enableSudoTouchIdAuth = true;

      # Necessary for using flakes on this system.
      nix.settings.experimental-features = "nix-command flakes";

      # Enable alternative shell support in nix-darwin.
      # programs.fish.enable = true;

      # Set Git commit hash for darwin-version.
      system.configurationRevision = self.rev or self.dirtyRev or null;

      # Used for backwards compatibility, please read the changelog before changing.
      # $ darwin-rebuild changelog
      system.stateVersion = 5;

      # The platform the configuration will be used on.
      nixpkgs.hostPlatform = "aarch64-darwin";
    };
  in
  {
    # Build darwin flake using:
    # $ darwin-rebuild build --flake .#macbook
    darwinConfigurations."macbook" = nix-darwin.lib.darwinSystem {
      modules = [ 
        configuration
        ];
    };
  };
}
