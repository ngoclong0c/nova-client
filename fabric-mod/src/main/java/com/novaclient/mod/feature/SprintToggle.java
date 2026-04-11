package com.novaclient.mod.feature;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;

/**
 * Sprint Toggle - Tự động chạy nhanh khi di chuyển về phía trước.
 * Bật/tắt bằng phím V.
 */
public class SprintToggle {

    /**
     * Áp dụng auto-sprint mỗi tick.
     * Khi bật: nếu người chơi đang đi về phía trước → tự động sprint.
     */
    public static void tick(MinecraftClient client) {
        if (!NovaConfig.sprintToggle) return;
        if (client.player == null || client.options == null) return;

        // Nếu đang nhấn phím đi tới và không đang ở trong menu
        if (client.options.forwardKey.isPressed() && client.currentScreen == null) {
            if (!client.player.isSprinting() && client.player.getHungerManager().getFoodLevel() > 6) {
                client.player.setSprinting(true);
            }
        }
    }
}
