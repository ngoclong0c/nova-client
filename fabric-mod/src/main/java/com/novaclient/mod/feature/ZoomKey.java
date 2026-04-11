package com.novaclient.mod.feature;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;

/**
 * Zoom Camera - Phóng to camera khi giữ phím C (giống OptiFine zoom).
 * FOV giảm từ bình thường xuống 30 khi giữ phím.
 */
public class ZoomKey {

    private static final double ZOOM_FOV = 30.0;
    private static double originalFov = -1;

    /**
     * Xử lý zoom mỗi tick.
     * Giữ phím C → zoom vào, thả phím → zoom ra.
     * @param client Minecraft client
     * @param zoomKey KeyBinding cho phím zoom
     */
    public static void tick(MinecraftClient client, KeyBinding zoomKey) {
        if (client.player == null || client.options == null) return;

        boolean isPressed = zoomKey.isPressed();

        if (isPressed && !NovaConfig.zoomActive) {
            // Bắt đầu zoom - lưu FOV gốc
            originalFov = client.options.getFov().getValue();
            client.options.getFov().setValue((int) ZOOM_FOV);
            NovaConfig.zoomActive = true;
            // Tăng smooth camera
            client.options.smoothCameraEnabled = true;
        } else if (!isPressed && NovaConfig.zoomActive) {
            // Dừng zoom - khôi phục FOV gốc
            if (originalFov > 0) {
                client.options.getFov().setValue((int) originalFov);
            }
            NovaConfig.zoomActive = false;
            client.options.smoothCameraEnabled = false;
            originalFov = -1;
        }
    }
}
