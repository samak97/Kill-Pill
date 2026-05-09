import React, { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { motion, AnimatePresence } from "framer-motion";
import { enable, isEnabled } from "@tauri-apps/plugin-autostart";
import "./Island.css";

export interface NotificationPayload {
  id: number;
  app_name: string;
  title: string;
  body: string;
}


interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  is_playing: boolean;
  thumbnail: string | null;
  position_ms: number;
  duration_ms: number;
}

const Visualizer: React.FC<{ active: boolean; color: string }> = ({ active, color }) => (
  <div className="ios-visualizer">
    {[1, 2, 3, 4, 5].map((i) => (
      <motion.div
        key={i}
        className="ios-bar"
        style={{ backgroundColor: color }}
        animate={active ? { height: [4, 16, 8, 20, 6] } : { height: 4 }}
        transition={
          active
            ? { repeat: Infinity, duration: 0.8, delay: i * 0.1, ease: "easeInOut" }
            : { duration: 0.3 }
        }
      />
    ))}
  </div>
);

const getAverageColor = (base64Str: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64Str}`;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve("#ff9f0a");
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      if (luminance < 40) {
        resolve(`rgb(${Math.min(255, r + 50)}, ${Math.min(255, g + 50)}, ${Math.min(255, b + 50)})`);
      } else {
        resolve(`rgb(${r}, ${g}, ${b})`);
      }
    };
    img.onerror = () => resolve("#ff9f0a");
  });
};

const formatTime = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const Island: React.FC = () => {
  const [expanded, setExpanded] = useState(false);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [localPos, setLocalPos] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [themeColor, setThemeColor] = useState("#ff9f0a");
  const [notification, setNotification] = useState<NotificationPayload | null>(null);
  const [showCollapsedMedia, setShowCollapsedMedia] = useState(false);

  const fetchingRef = useRef(false);
  const notifTimerRef = useRef<any>(null);
  const pauseTimerRef = useRef<any>(null);

  const isPlaying = media?.is_playing ?? false;

  useEffect(() => {
    if (isPlaying) {
      // Music resumed — cancel any pending hide and show media immediately
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
      setShowCollapsedMedia(true);
    } else {
      // Music paused — start 3 second countdown to hide
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => {
        setShowCollapsedMedia(false);
      }, 3000);
    }
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    // Enable startup on launch
    const initAutostart = async () => {
      try {
        if (!(await isEnabled())) {
          await enable();
        }
      } catch (err) {
        console.error("Autostart init failed:", err);
      }
    };
    initAutostart();
  }, []);

  useEffect(() => {
    const unlisten = listen<NotificationPayload>('notification_received', (event) => {
      console.log("Got notification:", event.payload);
      setNotification(event.payload);
      // Removed setExpanded(true) - now it only expands horizontally via CSS

      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
      notifTimerRef.current = setTimeout(() => {
        setNotification(null);
        setExpanded(false); // Ensure we collapse if it was fully expanded
      }, 7000); // 7s for more reading time
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  // Enable autostart on mount
  useEffect(() => {
    const initAutostart = async () => {
      try {
        if (!(await isEnabled())) {
          await enable();
        }
      } catch (err) {
        console.error("Autostart init failed", err);
      }
    };
    initAutostart();
  }, []);

  // Dynamic window resizing - Only animate height to prevent X-axis flickering
  useEffect(() => {
    const updateSize = async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const appWindow = getCurrentWebviewWindow();

        if (expanded) {
          await appWindow.setSize(new LogicalSize(370, 190));
        }
        else {
          setTimeout(async () => {
            if (!expanded) {
              await appWindow.setSize(new LogicalSize(370, 57));
            }
          }, 350);
        }
      } catch (err) {
        console.error("Window resize failed", err);
      }
    };
    updateSize();
  }, [expanded]);

  const fetchMedia = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const data = await invoke<MediaInfo | null>("get_media_info");
      if (data) {
        // Detect if the backend is reporting position in seconds instead of ms
        // (some browser-based players like YouTube do this via the OS Media API)
        // Heuristic: if position_ms looks impossibly small vs duration_ms, multiply by 1000
        let backendPos = data.position_ms;
        if (data.duration_ms > 1000 && backendPos < data.duration_ms / 100 && backendPos > 0) {
          // position is suspiciously small relative to duration — likely in seconds
          const asMs = backendPos * 1000;
          if (asMs <= data.duration_ms) {
            backendPos = asMs;
          }
        }
        // Clamp to valid range
        backendPos = Math.max(0, Math.min(backendPos, data.duration_ms));

        setMedia((prev) => {
          if (prev?.title !== data.title) {
            // New track — always snap position
            setLocalPos(backendPos);
            if (data.thumbnail) {
              getAverageColor(data.thumbnail).then(setThemeColor);
            } else {
              setThemeColor("#e0e0e0");
            }
          } else {
            setLocalPos((currentLocal) => {
              // Only snap to backend if we're very far off (seek or skip happened)
              // Use 8s threshold — avoids the 2-3s "jump back" artefact from API latency
              if (Math.abs(currentLocal - backendPos) > 8000) {
                return backendPos;
              }
              return currentLocal;
            });
          }
          return data;
        });
      } else {
        setMedia(null);
      }
    } catch (err) {
      console.error("media fetch error:", err);
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchMedia();
    const id = setInterval(fetchMedia, 1500);
    return () => clearInterval(id);
  }, [fetchMedia]);

  // Local 100ms ticker for smooth seek bar (no backward jumping)
  useEffect(() => {
    const id = setInterval(() => {
      setClock(new Date());
      if (media?.is_playing) {
        setLocalPos((p) => p + 100);
      }
    }, 100);
    return () => clearInterval(id);
  }, [media?.is_playing]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.screenX;
    const startY = e.screenY;

    const handleMouseMove = async (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.screenX - startX);
      const deltaY = Math.abs(moveEvent.screenY - startY);

      if (deltaX > 3 || deltaY > 3) {
        window.removeEventListener('mousemove', handleMouseMove);
        try {
          const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          await getCurrentWebviewWindow().startDragging();
        } catch (e) {
          console.error("Drag failed", e);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', () => {
      window.removeEventListener('mousemove', handleMouseMove);
    }, { once: true });
  };

  const handleControl = async (e: React.MouseEvent, command: string) => {
    e.stopPropagation();
    try {
      await invoke(command);
      // Immediately re-fetch to get the new state
      setTimeout(fetchMedia, 300);
    } catch (err) {
      console.error(`${command} failed:`, err);
    }
  };

  // isPlaying is declared earlier
  const duration = media?.duration_ms || 1;
  const progressPct = Math.min(100, Math.max(0, (localPos / duration) * 100));
  const remaining = Math.max(0, duration - localPos);

  return (
    <div className="island-wrapper">
      <motion.div
        className={`ios-island ${expanded ? "expanded" : notification ? "notif-active" : showCollapsedMedia ? "collapsed" : "collapsed-time-only"}`}
        onMouseDown={handleMouseDown}
        layout
        onClick={() => setExpanded((v) => !v)}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <AnimatePresence mode="wait">
          {!expanded ? (
            <motion.div
              key={notification ? "banner" : "collapsed"}
              className={notification ? "notif-banner" : "collapsed-view"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {notification ? (
                <>
                  <span className="notif-banner-icon">🔔</span>
                  <div className="notif-banner-text">
                    <span className="notif-banner-app">{notification.app_name || "Notification"}</span>
                    <span className="notif-banner-title">{notification.title}</span>
                  </div>
                </>
              ) : (
                <>
                  {/* Always center the time */}
                  <div className="compact-center-time">
                    {clock.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    }).toLowerCase()}
                  </div>

                  {/* Show media items if playing or recently paused */}
                  {showCollapsedMedia && (
                    <>
                      <div className="compact-left">
                        {media?.thumbnail ? (
                          <img
                            src={`data:image/png;base64,${media.thumbnail}`}
                            className="mini-art-img"
                            alt=""
                          />
                        ) : (
                          <div className="mini-art-placeholder">🎵</div>
                        )}
                      </div>
                      <div className="compact-right">
                        <Visualizer active={isPlaying} color={themeColor} />
                      </div>
                    </>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="expanded"
              className="expanded-view"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2 }}
            >
              {notification ? (
                <div className="notification-view">
                  <div className="notif-header">
                    <div className="notif-icon">🔔</div>
                    <span className="notif-app">{notification.app_name || "New Notification"}</span>
                    <span className="notif-time">now</span>
                  </div>
                  <div className="notif-content">
                    <div className="notif-title">{notification.title}</div>
                    <div className="notif-body">{notification.body}</div>
                  </div>
                </div>
              ) : media ? (
                <>
                  {/* Top row: art + info + visualizer */}
                  <div className="upper-section">
                    <div className="album-art-container">
                      {media.thumbnail ? (
                        <img
                          src={`data:image/png;base64,${media.thumbnail}`}
                          className="main-album-art-img"
                          alt=""
                        />
                      ) : (
                        <div className="main-album-art">🎵</div>
                      )}
                    </div>
                    <div className="info-group">
                      <div className="track-title">
                        {media.title || "Not Playing"}
                      </div>
                      <div className="artist-name">
                        {media.artist || "Unknown Artist"}
                      </div>
                    </div>
                    <Visualizer active={isPlaying} color={themeColor} />
                  </div>

                  {/* Progress bar */}
                  <div className="middle-section" onClick={(e) => e.stopPropagation()}>
                    <div className="time-display left">
                      {formatTime(localPos)}
                    </div>
                    <div
                      className="progress-container"
                      style={{ '--theme-color': themeColor } as React.CSSProperties}
                    >
                      <div className="ios-progress-bg" />
                      <div
                        className={`ios-progress-fill ${isPlaying ? 'playing' : ''}`}
                        style={{
                          width: `${progressPct}%`,
                          background: `linear-gradient(90deg, var(--theme-color) 0%, var(--theme-color) 100%)`
                        }}
                      />
                    </div>
                    <div className="time-display right">
                      -{formatTime(remaining)}
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="lower-section">
                    <motion.button
                      whileTap={{ scale: 0.75, opacity: 0.6 }}
                      className="ios-btn"
                      onClick={(e) => handleControl(e, "media_previous")}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6L18 18V6z" />
                      </svg>
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.75, opacity: 0.6 }}
                      className="ios-btn play-pause-btn"
                      onClick={(e) => handleControl(e, "media_play_pause")}
                    >
                      {isPlaying ? (
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      ) : (
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.75, opacity: 0.6 }}
                      className="ios-btn"
                      onClick={(e) => handleControl(e, "media_next")}
                    >
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                      </svg>
                    </motion.button>
                  </div>
                </>
              ) : (
                <div className="no-media">
                  <span className="time-text large">
                    {clock.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    }).toLowerCase()}
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};
