# 💊 Kill Pill

A premium, standalone Dynamic Island for Windows. Inspired by iOS, built for performance and high-fidelity aesthetics.

<img width="556" height="338" alt="20260509-1759-13 2404166" src="https://github.com/user-attachments/assets/c3e0cdfc-4e63-4432-abea-4fc70d7ed8e6" />


## ✨ Features

- **Native Media Integration**: Real-time sync with Spotify, YouTube (via browser), Apple Music, and more.
- **Intelligent Notifications**: Automatically captures Windows toasts (Discord, Mail, Telegram) using a robust SQLite-WAL polling engine—no UWP identity or packaging required.
- **Smooth Animations**: Powered by Framer Motion with spring physics and bouncy layout transitions.
- **Smart Logic**: 
  - Pause timeout (hides after 3 seconds).
  - Horizontal expansion for notifications.
  - 12-hour modern clock format.
- **Ultra Lightweight**: Built with Tauri and Rust, running as a transparent, always-on-top overlay.

## 🚀 Getting Started

### Installation

1. Download the latest `kill-pill.exe` from the [Releases](https://github.com/your-username/kill-pill/releases) page.
2. Run the executable.
3. The Island will appear at the top center of your screen.

### Building from Source

If you want to build it yourself:

1. Install [Rust](https://rustup.rs/) and [Bun](https://bun.sh/).
2. Clone the repository.
3. Install dependencies:
   ```bash
   bun install
   ```
4. Run in development mode:
   ```bash
   bun run tauri dev
   ```
5. Build the production executable:
   ```bash
   bun run tauri build
   ```

## 🛠️ Technology Stack

- **Frontend**: React + Vite + TypeScript
- **Backend**: Rust (Tauri v2)
- **Styling**: Vanilla CSS + Framer Motion
- **Native APIs**: Windows Media Control, SQLite (Windows Notification Database)

## ⚖️ License

MIT
