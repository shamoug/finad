// The background check: about every 15 minutes (Android's shortest interval for background work) while the phone has
// a network, it fetches the feed and notifies new alerts, and looks for a new version of the app.
package io.github.shamoug.finad;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

public class Notices extends Worker {
    public Notices(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void schedule(Context c) {
        PeriodicWorkRequest w = new PeriodicWorkRequest.Builder(Notices.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("finad-notices", ExistingPeriodicWorkPolicy.KEEP, w);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        try { Feed.fetch(c, true); } catch (Exception e) { /* offline or the store is busy: next time */ }
        try { Updater.checkIfDue(c); } catch (Exception e) { /* website not reachable: next time */ }
        return Result.success();
    }
}
