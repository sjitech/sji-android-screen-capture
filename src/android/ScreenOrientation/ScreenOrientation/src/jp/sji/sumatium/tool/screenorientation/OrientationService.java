package jp.sji.sumatium.tool.screenorientation;

import java.util.HashMap;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.PixelFormat;
import android.os.IBinder;
import android.support.v4.app.NotificationCompat;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowManager.LayoutParams;

public class OrientationService extends Service {
	boolean isViewAdded;
	View view;
	WindowManager wm;
	LayoutParams lp;
	static HashMap<String, Integer> actionMap;
	static {
		actionMap = new HashMap<String, Integer>();
		actionMap.put("landscape", ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
		actionMap.put("portrait", ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
	}

	@Override
	public void onCreate() {
		super.onCreate();
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		if (intent != null && intent.getAction() != null && actionMap.containsKey(intent.getAction())) {
			int want = actionMap.get(intent.getAction());
			if (!isViewAdded) {
				wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
				view = new View(this);
				lp = new LayoutParams(0, 0, LayoutParams.TYPE_SYSTEM_ALERT, LayoutParams.FLAG_NOT_FOCUSABLE | LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSPARENT);
				lp.screenOrientation = want;
				wm.addView(view, lp);
				isViewAdded = true;
				PendingIntent pi = PendingIntent.getService(this, 0, new Intent(this, this.getClass()), PendingIntent.FLAG_UPDATE_CURRENT);
				Notification n = new NotificationCompat.Builder(this).setContentTitle(getString(R.string.notify_title)).setContentText(getString(R.string.notify_content)).setSmallIcon(R.drawable.ic_launcher).setContentIntent(pi).build();
				startForeground(1, n);
			} else if (lp.screenOrientation != want) {
				lp.screenOrientation = want;
				wm.updateViewLayout(view, lp);
			}
		} else {
			stopForeground(true);
			stopSelf();
		}
		return START_REDELIVER_INTENT;
	}

	@Override
	public void onDestroy() {
		super.onDestroy();
		if (isViewAdded) {
			wm.removeView(view);
			isViewAdded = false;
		}
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}
}
