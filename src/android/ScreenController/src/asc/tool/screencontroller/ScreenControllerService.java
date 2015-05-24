package asc.tool.screencontroller;

import java.io.IOException;
import java.io.InputStream;
import java.util.NoSuchElementException;
import java.util.Scanner;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Handler;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.Process;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowManager.LayoutParams;

public class ScreenControllerService extends Service {
	String tag = "ASC";
	ScreenControllerService _this = this;
	Handler mainthreadAccessor;
	boolean debug;

	@Override
	public void onCreate() {
		super.onCreate();

		String socketName = getPackageName();
		LocalServerSocket srv;
		try {
			srv = new LocalServerSocket(socketName);
		} catch (Throwable e) {
			e.printStackTrace();
			stopSelf();
			return;
		}
		final LocalServerSocket _srv = srv;

		mainthreadAccessor = new Handler();
		startForeground(Process.myPid(), new Notification());

		new Thread() {
			public void run() {
				for (;;) {
					LocalSocket con;
					try {
						con = _srv.accept();
					} catch (Throwable e) {
						e.printStackTrace();
						System.exit(2);
						return;
					}
					InputStream ins;
					try {
						ins = con.getInputStream();
					} catch (IOException e) {
						e.printStackTrace();
						continue;
					}

					final Scanner _scanner = new Scanner(ins);
					new Thread() {
						public void run() {
							final Orient orient = new Orient();
							final Screen screen = new Screen();
							for (;;) {
								String cmd;
								try {
									cmd = _scanner.nextLine();
								} catch (NoSuchElementException e) {
									orient.free();
									screen.free();
									break;
								}

								if ("orient:landscape".equals(cmd)) {
									orient.set("landscape");
								} else if ("orient:portrait".equals(cmd)) {
									orient.set("portrait");
								} else if ("orient:free".equals(cmd)) {
									orient.free();
								} else if ("screen:on".equals(cmd)) {
									screen.turnOn(false);
								} else if ("screen:on+unlock".equals(cmd)) {
									screen.turnOn(true);
								} else if ("screen:free".equals(cmd)) {
									screen.free();
								} else if ("debug".equals(cmd)) {
									debug = true;
								} else if ("nodebug".equals(cmd)) {
									debug = false;
								}
							} // end of command loop

							_scanner.close();
						}; // end of thread of connection handler
					}.start();
				} // end of connection handler
			}; // end of thread of socket server
		}.start();
	}

	@Override
	public void onDestroy() {
		super.onDestroy();
		System.exit(1);
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}

	class Orient {
		boolean did_addGhostView;
		WindowManager wm;
		View ghostView;
		LayoutParams lp;

		public void set(final String orientStr) {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					action_free.run();
					if (debug)
						Log.d(tag, "orient:" + orientStr);

					if (wm == null)
						wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
					if (ghostView == null)
						ghostView = new View(_this);
					if (lp == null)
						lp = newGhostLayout();

					lp.screenOrientation = "landscape".equals(orientStr) ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;

					wm.addView(ghostView, lp);
					did_addGhostView = true;
				}
			});
		}

		public void free() {
			mainthreadAccessor.post(action_free);
		}

		Runnable action_free = new Runnable() {
			public void run() {
				if (did_addGhostView) {
					if (debug)
						Log.d(tag, "orient:free");
					wm.removeView(ghostView);
					did_addGhostView = false;
				}
			}
		};
	}

	class Screen {
		boolean did_addGhostView;
		WindowManager wm;
		View ghostView;
		LayoutParams lp;

		boolean did_acquireWakeLock;
		PowerManager powerManager;
		PowerManager.WakeLock wakeLock;

		boolean did_disableKeyguard;
		KeyguardManager keyGuardManager;
		KeyguardManager.KeyguardLock keyGuardLock;

		public void turnOn(final boolean unlock) {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					action_free.run();
					if (debug)
						Log.d(tag, "screen:on" + (unlock ? "+unlock" : ""));

					if (wm == null)
						wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
					if (ghostView == null)
						ghostView = new View(_this);
					if (lp == null) {
						lp = newGhostLayout();
						lp.flags |= LayoutParams.FLAG_SHOW_WHEN_LOCKED;
						lp.flags |= LayoutParams.FLAG_TURN_SCREEN_ON;
						lp.flags |= LayoutParams.FLAG_KEEP_SCREEN_ON;
						lp.flags |= LayoutParams.FLAG_DISMISS_KEYGUARD;
					}

					wm.addView(ghostView, lp);
					did_addGhostView = true;

					if (powerManager == null)
						powerManager = (PowerManager) getSystemService(POWER_SERVICE);
					if (wakeLock == null)
						wakeLock = powerManager.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, _this.getPackageName() + '#' + Thread.currentThread().getId());
					wakeLock.acquire();
					did_acquireWakeLock = true;

					if (unlock) {
						if (keyGuardManager == null)
							keyGuardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
						if (keyGuardLock == null)
							keyGuardLock = keyGuardManager.newKeyguardLock(_this.getPackageName() + '#' + Thread.currentThread().getId());
						keyGuardLock.disableKeyguard();
						did_disableKeyguard = true;
					}
				}
			});
		}

		public void free() {
			mainthreadAccessor.post(action_free);
		}

		Runnable action_free = new Runnable() {
			public void run() {
				if (debug && (did_addGhostView || did_acquireWakeLock || did_disableKeyguard))
					Log.d(tag, "screen:free");

				if (did_addGhostView) {
					wm.removeView(ghostView);
					did_addGhostView = false;
				}
				if (did_acquireWakeLock) {
					wakeLock.release();
					did_acquireWakeLock = false;
				}
				if (did_disableKeyguard) {
					keyGuardLock.reenableKeyguard();
					did_disableKeyguard = false;
				}
			}
		};
	}

	LayoutParams newGhostLayout() {
		LayoutParams lp = new LayoutParams();
		lp.type = LayoutParams.TYPE_SYSTEM_ERROR;
		lp.width = 0;
		lp.height = 0;
		lp.flags = 0;
		lp.flags |= LayoutParams.FLAG_NOT_FOCUSABLE;
		lp.flags |= LayoutParams.FLAG_NOT_TOUCHABLE;
		return lp;
	}
}
