package io.github.kezersouza.snowgo;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Snow Go: the web game in a WebView, always in landscape (AndroidManifest: sensorLandscape),
 * fullscreen (status and navigation bars hidden; a swipe from the edge shows them for a moment),
 * edge to edge (the game also draws under the camera cutout, which in landscape sits on the left or right edge)
 * and with the screen kept on while the app is open.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Everything that touches the window goes AFTER super.onCreate: BridgeActivity switches from the splash theme
        // to AppTheme.NoActionBar in there. Before it, on Android 10 and older, setDecorFitsSystemWindows builds the
        // window with the splash theme (a title bar with "Snow Go" and the splash image squashed into it).
        super.onCreate(savedInstanceState);
        // By default Android keeps a landscape app out of the camera cutout and paints that strip with the window
        // background (a gray bar along the camera edge). SHORT_EDGES lets the game use it; the HUD keeps its text
        // clear of it through the CSS safe-area insets.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars(); // they come back after a dialog, the keyboard or an app switch
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
