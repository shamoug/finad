// After the phone starts: schedule the background check again.
package io.github.shamoug.finad;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class Boot extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) Notices.schedule(c);
    }
}
