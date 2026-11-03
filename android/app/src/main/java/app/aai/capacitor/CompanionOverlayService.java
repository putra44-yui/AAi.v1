package id.aai.personal;

import android.animation.ObjectAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/** AAi's opt-in Android overlay. It uses the canonical bundled PNG, not the old
 * Next/Vercel site or a newly generated mascot.
 *
 * F3 prototype: native comic pages, independent bottom composer, touch gestures,
 * local reactions. Actual sending of text is delegated to the existing AAi
 * Chatbot Activity while per-user native Auth and background SSE are unfinished.
 */
public final class CompanionOverlayService extends Service {
    public static final String ACTION_SHOW = "id.aai.personal.COMPANION_SHOW";
    public static final String ACTION_STOP = "id.aai.personal.COMPANION_STOP";
    public static final String ACTION_UPDATE = "id.aai.personal.COMPANION_UPDATE";
    public static final String ACTION_COMPOSER = "id.aai.personal.COMPANION_COMPOSER";
    private static final int NOTIFICATION_ID = 8426;
    private static final String CHANNEL = "aai_companion_active";
    private static volatile boolean running = false;

    public static boolean isRunning() { return running; }

    private WindowManager wm;
    private LinearLayout floatingWidget;
    private LinearLayout bottomComposer;
    private ImageView mascotImage;
    private TextView speechText;
    private TextView pageNumber;
    private Button prevButton, nextButton;
    private WindowManager.LayoutParams widgetParams;
    private WindowManager.LayoutParams composerParams;
    private ObjectAnimator breathing;
    private final ArrayList<String> pages = new ArrayList<>();
    private final Random random = new Random();
    private int page = 0;
    private int previousReaction = -1;
    private boolean composerVisible = true;
    private boolean streaming = false;
    private long lastReactionAt = 0L;
    private int reactionCount = 0;

    private int dp(float value) { return Math.round(getResources().getDisplayMetrics().density * value); }

    private GradientDrawable shape(int color, int stroke, float radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        if (stroke != 0) drawable.setStroke(dp(1),stroke);
        return drawable;
    }

    private TextView makeLabel(String text, float size, int color) {
        TextView t = new TextView(this);
        t.setText(text);t.setTextSize(size);t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    @Override public void onCreate() {
        super.onCreate();
        wm=(WindowManager)getSystemService(WINDOW_SERVICE);
        createNotificationChannel();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action=intent == null ? ACTION_SHOW : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_SHOW.equals(action) || action == null) {
            composerVisible=intent == null || intent.getBooleanExtra("showComposer",true);
            showNotification();
            if (floatingWidget == null) {
                createFloatingWidget();
                createBottomComposer();
            }
            running=true;
        } else if (ACTION_UPDATE.equals(action) && floatingWidget != null) {
            streaming=intent.getBooleanExtra("streaming",false);
            updateSpeech(intent.getStringExtra("text"));
        } else if (ACTION_COMPOSER.equals(action)) {
            composerVisible=intent.getBooleanExtra("visible",true);
            if(floatingWidget!=null) updateComposerVisibility();
        }
        return START_NOT_STICKY; // Never resurrect after user stops the overlay.
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            manager.createNotificationChannel(new NotificationChannel(CHANNEL,
                "AAi Pendamping",NotificationManager.IMPORTANCE_LOW));
        }
    }
    private PendingIntent openChatIntent() {
        Intent app=new Intent(this,MainActivity.class);
        app.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(this,0,app,
            PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private void showNotification() {
        Intent stop=new Intent(this,CompanionOverlayService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopAction=PendingIntent.getService(this,1,stop,
            PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26
            ? new Notification.Builder(this,CHANNEL) : new Notification.Builder(this);
        Notification note=builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("AAi sedang menemanimu")
            .setContentText("Sentuh untuk membuka chat, atau hentikan mode mengambang.")
            .setContentIntent(openChatIntent())
            .setOngoing(true)
            .addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel,"Hentikan",stopAction).build())
            .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID,note,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else startForeground(NOTIFICATION_ID,note);
    }

    private void createFloatingWidget() {
        floatingWidget=new LinearLayout(this);
        floatingWidget.setOrientation(LinearLayout.VERTICAL);
        floatingWidget.setGravity(Gravity.CENTER_HORIZONTAL);
        floatingWidget.setPadding(dp(3),dp(4),dp(3),dp(5));
        floatingWidget.setBackgroundColor(Color.TRANSPARENT);

        LinearLayout bubble=new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(dp(9),dp(9),dp(9),dp(9));
        bubble.setBackground(shape(Color.WHITE,Color.rgb(185,163,224),22));
        LinearLayout.LayoutParams bubbleMargin=new LinearLayout.LayoutParams(dp(264),-2);
        bubbleMargin.bottomMargin=dp(8);
        floatingWidget.addView(bubble,bubbleMargin);
        pageNumber=makeLabel("AAi ✦",10,Color.rgb(136,115,173));
        bubble.addView(pageNumber,new LinearLayout.LayoutParams(-1,dp(22)));

        LinearLayout pager=new LinearLayout(this);
        pager.setGravity(Gravity.CENTER_VERTICAL);
        prevButton=new Button(this);
        prevButton.setText("‹");prevButton.setTextSize(21);prevButton.setAllCaps(false);
        prevButton.setContentDescription("Halaman sebelumnya");
        prevButton.setBackground(shape(0xFFF2EEFB,0,12));
        pager.addView(prevButton,new LinearLayout.LayoutParams(dp(41),dp(49)));

        speechText=makeLabel("Aku di sini, ya. ✦",15,Color.rgb(70,55,102));
        speechText.setMaxLines(6);
        speechText.setPadding(dp(5),dp(4),dp(5),dp(4));
        LinearLayout.LayoutParams middle=new LinearLayout.LayoutParams(0,dp(83),1f);
        pager.addView(speechText,middle);

        nextButton=new Button(this);
        nextButton.setText("›");nextButton.setTextSize(21);nextButton.setAllCaps(false);
        nextButton.setContentDescription("Halaman berikutnya");
        nextButton.setBackground(shape(0xFFF2EEFB,0,12));
        pager.addView(nextButton,new LinearLayout.LayoutParams(dp(41),dp(49)));
        bubble.addView(pager);
        prevButton.setOnClickListener(v->goPage(-1));
        nextButton.setOnClickListener(v->goPage(1));
        setPages("Aku di sini, ya. ✦");

        mascotImage=new ImageView(this);
        mascotImage.setScaleType(ImageView.ScaleType.FIT_CENTER);
        mascotImage.setContentDescription("Maskot asli AAi dengan kristal bertuliskan AAi");
        try (InputStream source=getAssets().open("public/aai-mascot-studio.png")) {
            Bitmap image=BitmapFactory.decodeStream(source);
            if (image != null) mascotImage.setImageBitmap(image);
        } catch (Exception ignored) {
            // Never silently replace the AAi mascot with stock artwork.
        }
        floatingWidget.addView(mascotImage,new LinearLayout.LayoutParams(dp(159),dp(185)));
        installMascotGesture();

        widgetParams=new WindowManager.LayoutParams(
            dp(282),WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
        widgetParams.gravity=Gravity.TOP|Gravity.START;
        widgetParams.x=dp(35);
        widgetParams.y=dp(105);
        try {wm.addView(floatingWidget,widgetParams);} catch (Exception e) {
            floatingWidget=null;stopSelf();return;
        }

        breathing=ObjectAnimator.ofFloat(mascotImage,View.TRANSLATION_Y,0,-dp(3),0);
        breathing.setDuration(3600);
        breathing.setRepeatCount(ObjectAnimator.INFINITE);
        breathing.setInterpolator(new AccelerateDecelerateInterpolator());
        breathing.start();
    }

    private void installMascotGesture() {
        mascotImage.setOnTouchListener(new View.OnTouchListener() {
            float rawX,rawY,startX,startY;
            long touchedAt;boolean moved;
            @Override public boolean onTouch(View view, MotionEvent event) {
                if(widgetParams==null||floatingWidget==null)return false;
                switch(event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        rawX=event.getRawX();rawY=event.getRawY();
                        startX=widgetParams.x;startY=widgetParams.y;
                        touchedAt=System.currentTimeMillis();moved=false;return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx=event.getRawX()-rawX,dy=event.getRawY()-rawY;
                        if(Math.hypot(dx,dy)>dp(9))moved=true;
                        if(moved) {
                            int maxX=Math.max(0,getResources().getDisplayMetrics().widthPixels-dp(282));
                            int maxY=Math.max(0,getResources().getDisplayMetrics().heightPixels-dp(340));
                            widgetParams.x=Math.max(0,Math.min(maxX,Math.round(startX+dx)));
                            widgetParams.y=Math.max(0,Math.min(maxY,Math.round(startY+dy)));
                            try{wm.updateViewLayout(floatingWidget,widgetParams);}catch(Exception ignored){}
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if(!moved) {
                            if(System.currentTimeMillis()-touchedAt>550) {
                                composerVisible=!composerVisible;updateComposerVisibility();
                            } else onMascotTap(event.getY()/Math.max(1,view.getHeight()));
                        }
                        return true;
                    case MotionEvent.ACTION_CANCEL:return true;
                    default:return false;
                }
            }
        });
    }

    private void onMascotTap(float relativeY) {
        if (!composerVisible) {composerVisible=true;updateComposerVisibility();}
        if(breathing!=null)breathing.cancel();
        mascotImage.animate().rotation(-4f).setDuration(120).withEndAction(() ->
            mascotImage.animate().rotation(0f).setDuration(220).withEndAction(() -> {
                if(breathing!=null)breathing.start();
            }).start()).start();
        long now=System.currentTimeMillis();
        reactionCount=now-lastReactionAt<2800?reactionCount+1:1;
        lastReactionAt=now;
        // F3 preliminary zones: canonical sprite inspection/hitbox acceptance
        // is required before enabling precise head/protection poses in release.
        final String[] normal={"Hmm? Ada apa?","Heii, kaget aku.","Iya, aku di sini.","Mau cerita apa?","Ih, tiba-tiba banget."};
        final String[] head={"Duh… jangan pegang kepala, malu.","Ih, rambutku berantakan.","Heii, pelan dong…","Aku bisa rapiin rambut sendiri."};
        final String[] protect={"Duh… jangan dipegang, malu.","Ih, jangan begitu dong.","Heii, jaga tangan, ya.","Aku mundur dulu… malu."};
        final String[] repeat={"Heii… dari tadi usil terus.","Aku lihat, kamu sengaja ya?","Ehem, jaga tangan.","Ih, cukup dulu, ya."};
        String[] pool=reactionCount>=4?repeat:relativeY<.35f?head:relativeY<.72f?protect:normal;
        int selected=random.nextInt(pool.length);
        if(selected==previousReaction)selected=(selected+1)%pool.length;
        previousReaction=selected;
        streaming=false;
        setPages(pool[selected]);
    }

    private void createBottomComposer() {
        bottomComposer=new LinearLayout(this);
        bottomComposer.setPadding(dp(13),dp(9),dp(13),dp(11));
        bottomComposer.setOrientation(LinearLayout.HORIZONTAL);
        bottomComposer.setGravity(Gravity.CENTER_VERTICAL);
        bottomComposer.setBackground(shape(0xF7FFFFFF,0xFFDACDEE,21));
        EditText edit=new EditText(this);
        edit.setSingleLine(true);
        edit.setTextSize(15);
        edit.setHint("Tulis pesan untuk AAi…");
        edit.setBackgroundColor(Color.TRANSPARENT);
        edit.setPadding(dp(8),0,dp(8),0);
        LinearLayout.LayoutParams editParams=new LinearLayout.LayoutParams(0,dp(44),1);
        bottomComposer.addView(edit,editParams);
        Button send=new Button(this);
        send.setText("Chat");send.setAllCaps(false);
        send.setTextColor(Color.rgb(72,54,116));
        send.setContentDescription("Buka AAi Chatbot untuk mengirim pesan");
        send.setBackground(shape(0xFFEDE4FF,0xFFCCBCE8,14));
        bottomComposer.addView(send,new LinearLayout.LayoutParams(dp(67),dp(46)));
        send.setOnClickListener(v -> {
            Intent app=new Intent(this,MainActivity.class);
            app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
            String draft=edit.getText().toString().trim();
            if(!draft.isEmpty()) app.putExtra("AAI_COMPANION_DRAFT",draft);
            startActivity(app);
            edit.setText("");
        });
        composerParams=new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT);
        composerParams.gravity=Gravity.BOTTOM;
        composerParams.softInputMode=WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        updateComposerVisibility();
    }

    private void updateComposerVisibility() {
        if(wm==null || bottomComposer==null || composerParams==null)return;
        try {
            if(composerVisible&&bottomComposer.getParent()==null)
                wm.addView(bottomComposer,composerParams);
            else if(!composerVisible&&bottomComposer.getParent()!=null)
                wm.removeView(bottomComposer);
        } catch(Exception ignored){}
    }
    private void updateSpeech(String text) {
        if(text==null||text.trim().isEmpty())return;
        setPages(text);
    }
    private void setPages(String original) {
        String text=original.replaceAll("[\r\n]+"," ").replaceAll("\\s+"," ").trim();
        pages.clear();
        String[] sentences=text.split("(?<=[.!?。！？])\\s+");
        StringBuilder current=new StringBuilder();
        for(String sentence:sentences){
            for(String word:sentence.trim().split("\\s+")){
                if(word.length()>150)word=word.substring(0,150);
                if(current.length()+word.length()+1>124&&current.length()>0){
                    pages.add(current.toString());current.setLength(0);
                }
                if(current.length()>0)current.append(" ");
                current.append(word);
            }
        }
        if(current.length()>0)pages.add(current.toString());
        if(pages.isEmpty())pages.add("Aku di sini, ya.");
        page=Math.min(page,pages.size()-1);
        renderPage();
    }
    private void goPage(int move) {
        page=Math.max(0,Math.min(pages.size()-1,page+move));
        renderPage();
    }
    private void renderPage() {
        if(speechText==null)return;
        speechText.setText(pages.get(page));
        pageNumber.setText(pages.size()>1?(page+1)+" / "+pages.size():"AAi ✦");
        prevButton.setEnabled(page>0);
        nextButton.setEnabled(page<pages.size()-1);
        prevButton.setAlpha(page>0?1f:.28f);
        nextButton.setAlpha(page<pages.size()-1?1f:.28f);
    }

    @Override public void onDestroy() {
        running=false;
        if(breathing!=null){breathing.cancel();breathing=null;}
        if(wm!=null){
            try{if(floatingWidget!=null&&floatingWidget.getParent()!=null)wm.removeView(floatingWidget);}catch(Exception ignored){}
            try{if(bottomComposer!=null&&bottomComposer.getParent()!=null)wm.removeView(bottomComposer);}catch(Exception ignored){}
        }
        floatingWidget=null;bottomComposer=null;
        super.onDestroy();
    }
}
