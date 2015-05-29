package asc.tool.screencontroller;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.NoSuchElementException;
import java.util.Scanner;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
	WindowManager wm;
	PowerManager powerManager;
	KeyguardManager keyguardManager;
	boolean debug;
	ArrayList<LocalSocket> conAry = new ArrayList<LocalSocket>();

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

		IntentFilter screenStateFilter = new IntentFilter();
		screenStateFilter.addAction(Intent.ACTION_SCREEN_ON);
		screenStateFilter.addAction(Intent.ACTION_SCREEN_OFF);
		registerReceiver(stateReceiver, screenStateFilter);

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

					synchronized (conAry) {
						conAry.add(con);
					}

					mainthreadAccessor.post(action_startForeground);

					final LocalSocket _con = con;
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

							synchronized (conAry) {
								conAry.remove(_con);
							}

							mainthreadAccessor.post(action_stopForeground);

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
		View ghostView;
		LayoutParams lp;

		public void set(final String orientStr) {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					if (debug)
						Log.d(tag, "orient:" + orientStr);

					if (wm == null)
						wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
					View ghostView_to_deleted = ghostView;
					ghostView = new View(_this);
					if (lp == null)
						lp = newGhostLayout();

					lp.screenOrientation = "landscape".equals(orientStr) ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT;

					wm.addView(ghostView, lp);

					if (ghostView_to_deleted != null)
						wm.removeView(ghostView_to_deleted);
				}
			});
		}

		public void free() {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					if (ghostView != null) {
						if (debug)
							Log.d(tag, "orient:free");
						wm.removeView(ghostView);
						ghostView = null;
					}
				}
			});
		}
	}

	class Screen {
		View ghostView;
		LayoutParams lp;

		PowerManager.WakeLock wakeLock;

		KeyguardManager.KeyguardLock keyguardLock;

		public void turnOn(final boolean unlock) {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					if (debug)
						Log.d(tag, "screen:on" + (unlock ? "+unlock" : ""));

					if (wm == null)
						wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
					View old_ghostView = ghostView;
					ghostView = new View(_this);
					if (lp == null) {
						lp = newGhostLayout();
						lp.flags |= LayoutParams.FLAG_SHOW_WHEN_LOCKED;
						lp.flags |= LayoutParams.FLAG_TURN_SCREEN_ON;
						lp.flags |= LayoutParams.FLAG_KEEP_SCREEN_ON;
					}
					if (unlock)
						lp.flags |= LayoutParams.FLAG_DISMISS_KEYGUARD;

					wm.addView(ghostView, lp);

					if (old_ghostView != null)
						wm.removeView(old_ghostView);

					if (powerManager == null)
						powerManager = (PowerManager) getSystemService(POWER_SERVICE);
					PowerManager.WakeLock old_wakeLock = wakeLock;
					wakeLock = powerManager.newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, _this.getPackageName() + '#' + Thread.currentThread().getId());
					wakeLock.acquire();

					if (old_wakeLock != null)
						old_wakeLock.release();

					if (unlock) {
						if (keyguardManager == null)
							keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
						if (keyguardLock == null) {
							keyguardLock = keyguardManager.newKeyguardLock(_this.getPackageName() + '#' + Thread.currentThread().getId());
						}
						keyguardLock.disableKeyguard();
					}
				}
			});
		}

		public void free() {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					if (debug && (ghostView != null || wakeLock != null || keyguardLock != null))
						Log.d(tag, "screen:free");

					if (ghostView != null) {
						wm.removeView(ghostView);
						ghostView = null;
					}
					if (wakeLock != null) {
						wakeLock.release();
						wakeLock = null;
					}
					if (keyguardLock != null) {
						keyguardLock.reenableKeyguard();
					}
				}
			});
		}
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

	int foreground_count = 0;
	Runnable action_startForeground = new Runnable() {
		public void run() {
			if (foreground_count == 0) {
				startForeground(Process.myPid(), new Notification());
			}
			foreground_count++;
		}
	};

	Runnable action_stopForeground = new Runnable() {
		public void run() {
			foreground_count--;
			if (foreground_count <= 0) {
				foreground_count = 0;
				stopForeground(true);
			}
		}
	};

	BroadcastReceiver stateReceiver = new BroadcastReceiver() {
		byte[] on = "screen:on\n".getBytes();
		byte[] off = "screen:off\n".getBytes();

		public void onReceive(Context context, Intent intent) {
			if (intent == null || intent.getAction() == null)
				return;
			if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
				notifyClient(off);
			} else if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) {
				notifyClient(on);
			}
		}

		void notifyClient(byte[] buf) {
			synchronized (conAry) {
				for (LocalSocket con : conAry) {
					try {
						con.getOutputStream().write(buf);
					} catch (IOException e) {
						e.printStackTrace();
					}
				}
			}
		}
	};
}
