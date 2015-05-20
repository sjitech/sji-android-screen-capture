package asc.tool.screenorientation;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.NoSuchElementException;
import java.util.Scanner;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Handler;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.app.NotificationCompat;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowManager.LayoutParams;

public class OrientationService extends Service {
	static String tag = "ASC";
	static HashMap<String, Integer> orientMap = new HashMap<String, Integer>();
	static {
		orientMap.put("landscape", ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
		orientMap.put("portrait", ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
		orientMap.put("free", ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
	}
	WindowManager wm;
	View ghostView;
	LayoutParams lp;
	boolean isViewAdded = false;
	static Handler mainthreadAccessor;
	boolean notified = false;
	long ownerThreadId = -1;
	public KeyguardManager keyGuardManager;
	public PowerManager powerManager;

	Runnable action_set_orient = new Runnable() {
		public void run() {
			synchronized (lp) {
				String orientStr = (lp.screenOrientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE ? "landscape" : lp.screenOrientation == ActivityInfo.SCREEN_ORIENTATION_PORTRAIT ? "portrait" : "free");
				if (isViewAdded) {
					Log.d(tag, "update ghost view orientation: " + orientStr);
					wm.updateViewLayout(ghostView, lp);
				} else {
					if (lp.screenOrientation != ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) {
						Log.d(tag, "add ghost view with orientation: " + orientStr);
						wm.addView(ghostView, lp);
						isViewAdded = true;
					}
				}
				if (lp.screenOrientation == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) {
					if (notified) {
						stopForeground(true);
						notified = false;
					}
				} else {
					startForeground(1, notification_youCanStopService);
					notified = true;
				}
				mainthreadAccessor.removeCallbacks(action_set_orient);
			}
		}
	};
	Notification notification_youCanStopService;

	@Override
	public void onCreate() {
		super.onCreate();

		String socketName = OrientationService.this.getClass().getPackage().getName();
		Log.d(tag, "create server socket: " + socketName);
		LocalServerSocket srv;
		try {
			srv = new LocalServerSocket(socketName);
		} catch (Throwable e) {
			Log.e(tag, "new LocalServerSocket() error: " + e.getMessage());
			e.printStackTrace();
			stopSelf();
			return;
		}

		Log.d(tag, "prepare ghost view");
		wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
		ghostView = new View(this);
		lp = new LayoutParams();
		lp.type = LayoutParams.TYPE_SYSTEM_OVERLAY;
		lp.width = 0;
		lp.height = 0;
		lp.flags = 0;
		lp.flags |= LayoutParams.FLAG_NOT_FOCUSABLE;
		lp.flags |= LayoutParams.FLAG_NOT_TOUCHABLE;

		lp.screenOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;

		Log.d(tag, "prepare notification");
		Intent intent_stopService = new Intent("stopService", null, this, this.getClass());
		PendingIntent serviceIntent = PendingIntent.getService(this, 0, intent_stopService, PendingIntent.FLAG_UPDATE_CURRENT);

		NotificationCompat.Builder nb = new NotificationCompat.Builder(this);
		nb.setContentTitle(getString(R.string.notify_title));
		nb.setContentText(getString(R.string.notify_content));
		nb.setSmallIcon(R.drawable.ic_launcher);
		nb.setOngoing(true);
		nb.setContentIntent(serviceIntent);
		notification_youCanStopService = nb.build();

		Log.d(tag, "prepare others");
		keyGuardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
		powerManager = (PowerManager) getSystemService(POWER_SERVICE);

		mainthreadAccessor = new Handler();

		Log.d(tag, "create socket server thread");
		final LocalServerSocket _srv = srv;
		new Thread() {
			public void run() {
				for (;;) {
					LocalSocket con;
					try {
						Log.d(tag, "listening");
						con = _srv.accept();
					} catch (Throwable e) {
						Log.e(tag, "accept() error: " + e.getMessage());
						e.printStackTrace();
						System.exit(2);
						return;
					}
					Log.d(tag, "connected, get input stream");
					InputStream ins;
					try {
						ins = con.getInputStream();
					} catch (IOException e) {
						Log.e(tag, "getInputStream() error: " + e.getMessage());
						e.printStackTrace();
						continue;
					}

					final Scanner _scanner = new Scanner(ins);
					final LocalSocket _con = con;
					new Thread() {
						public void run() {
							final ScreenUnlocker screenUnlocker = new ScreenUnlocker();
							for (;;) {
								Log.d(tag, "waiting command");
								String cmd;
								try {
									cmd = _scanner.nextLine();
								} catch (NoSuchElementException e) {
									Log.d(tag, "EOF");
									synchronized (lp) {
										if (ownerThreadId == Thread.currentThread().getId()) {
											lp.screenOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
											mainthreadAccessor.postDelayed(action_set_orient, 0);
											ownerThreadId = -1;
										}
									}
									screenUnlocker.close();
									break;
								}

								Log.d(tag, "got command: " + cmd);
								Integer orient = orientMap.get(cmd);

								if (orient != null) {
									synchronized (lp) {
										ownerThreadId = (orient == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) ? -1 : Thread.currentThread().getId();
										if (lp.screenOrientation != orient) {
											lp.screenOrientation = orient;
											mainthreadAccessor.postDelayed(action_set_orient, 0);
										}
									}
								} else if ("open".equals(cmd)) {
									screenUnlocker.open();
								} else if ("close".equals(cmd)) {
									screenUnlocker.close();
								}
							} // end of command loop

							try {
								_scanner.close();
							} catch (Throwable e) {
							}
							try {
								_con.close();
							} catch (Throwable e) {
							}
						}; // end of thread of connection handler
					}.start();
				} // end of connection handler
			}; // end of thread of socket server
		}.start();
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		Log.d(tag, "onStartCommand");
		if (intent != null && "stopService".equals(intent.getAction())) {
			synchronized (lp) {
				if (lp.screenOrientation != ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) {
					lp.screenOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
					action_set_orient.run();
				}
				ownerThreadId = -1;
			}
		}
		return START_STICKY;
	}

	@Override
	public void onDestroy() {
		Log.d(tag, "onDestroy");
		super.onDestroy();
		System.exit(1);
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}

	class ScreenUnlocker {
		public boolean opened;
		public View ghostView;
		LayoutParams lp;
		KeyguardManager.KeyguardLock keyGuardLock;
		PowerManager.WakeLock wakeLock;

		public void open() {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					if (opened)
						return;
					if (ghostView == null) {
						ghostView = new View(OrientationService.this);
						lp = new LayoutParams();
						lp.type = LayoutParams.TYPE_SYSTEM_OVERLAY;
						lp.width = 0;
						lp.height = 0;
						lp.flags = 0;
						lp.flags |= LayoutParams.FLAG_NOT_FOCUSABLE;
						lp.flags |= LayoutParams.FLAG_NOT_TOUCHABLE;
						lp.flags |= LayoutParams.FLAG_SHOW_WHEN_LOCKED;
						lp.flags |= LayoutParams.FLAG_TURN_SCREEN_ON;
						lp.flags |= LayoutParams.FLAG_KEEP_SCREEN_ON;
						lp.flags |= LayoutParams.FLAG_DISMISS_KEYGUARD;
					}
					if (keyGuardLock == null)
						keyGuardLock = keyGuardManager.newKeyguardLock("ASC");
					if (wakeLock == null)
						wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "ASC");
					wm.addView(ghostView, lp);
					try {
						keyGuardLock.disableKeyguard();
					} catch (Throwable e) {
						Log.d(tag, "disableKeyguard() error: " + e.getMessage());
						e.printStackTrace();
					}
					try {
						wakeLock.acquire();
					} catch (Throwable e) {
						Log.d(tag, "wakeLock.acquire() error: " + e.getMessage());
						e.printStackTrace();
					}
					Log.d(tag, "screenUnlocker opened");
					opened = true;
				}
			});
		}

		public void close() {
			mainthreadAccessor.post(new Runnable() {
				public void run() {
					if (!opened)
						return;
					wm.removeView(ghostView);
					try {
						keyGuardLock.reenableKeyguard();
					} catch (Throwable e) {
						Log.d(tag, "reenableKeyguard() error: " + e.getMessage());
						e.printStackTrace();
					}
					try {
						wakeLock.release();
					} catch (Throwable e) {
						Log.d(tag, "wakeLock.release() error: " + e.getMessage());
						e.printStackTrace();
					}
					Log.d(tag, "screenUnlocker closed");
					opened = false;
				}
			});
		}
	}
}
