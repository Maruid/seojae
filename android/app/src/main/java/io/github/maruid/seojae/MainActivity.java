package io.github.maruid.seojae;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SeojaePlugin.class);
        super.onCreate(savedInstanceState);
    }

    // 볼륨키 → 읽기 화면 넘기기 (웹이 켜 둔 동안만, 그 밖에는 원래대로 소리 크기)
    //   아래 = 다음 화면, 위 = 이전 화면. 누를 때 한 번 웹에 알리고, 떼는 신호까지 앱이 받아서 소리 크기는 안 바뀜
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        boolean volume = code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_VOLUME_UP;
        if (volume && SeojaePlugin.volumeKeys && getBridge() != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                String dir = code == KeyEvent.KEYCODE_VOLUME_DOWN ? "next" : "prev";
                getBridge().triggerWindowJSEvent("seojaeVolumeKey", "{\"dir\":\"" + dir + "\",\"repeat\":" + event.getRepeatCount() + "}");
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
