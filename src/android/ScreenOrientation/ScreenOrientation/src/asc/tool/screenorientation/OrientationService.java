package asc.tool.screenorientation;

import java.util.HashMap;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.IBinder;
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
		actionMap.put("free", ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
	}

	@Override
	public void onCreate() {
		super.onCreate();
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		int want = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
		if (intent != null && intent.getAction() != null && actionMap.containsKey(intent.getAction())) {
			want = actionMap.get(intent.getAction());
			android.util.Log.i("ScreenOrientation", "action: " + intent.getAction());
		} else {
			android.util.Log.i("ScreenOrientation", "action: unknown");
		}
		if (!isViewAdded) {
			android.util.Log.i("ScreenOrientation", "add view");
			wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
			view = new View(this);
			lp = new LayoutParams(0, 0, LayoutParams.TYPE_SYSTEM_ERROR, LayoutParams.FLAG_NOT_FOCUSABLE | LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.TRANSPARENT);
			lp.screenOrientation = want;
			wm.addView(view, lp);
			isViewAdded = true;
		} else if (lp.screenOrientation != want) {
			android.util.Log.i("ScreenOrientation", "update view");
			lp.screenOrientation = want;
			wm.updateViewLayout(view, lp);
		}
		new Handler().postDelayed(new Runnable() {

			@Override
			public void run() {
				android.util.Log.i("ScreenOrientation", "free");
				lp.screenOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
				wm.updateViewLayout(view, lp);
			}
		}, 0);
		return START_REDELIVER_INTENT;
	}

	@Override
	public IBinder onBind(Intent intent) {
		return null;
	}
}
