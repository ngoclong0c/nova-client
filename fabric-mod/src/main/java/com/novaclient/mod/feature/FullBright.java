package com.novaclient.mod.feature;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;

/**
 * FullBright - Tăng gamma lên max để nhìn trong tối như ban ngày.
 * Bật/tắt bằng phím G.
 */
public class FullBright {

    private static double originalGamma = -1;

    /**
     * Áp dụng FullBright mỗi tick.
     * Khi bật: set gamma = 15.0 (siêu sáng)
     * Khi tắt: khôi phục gamma gốc
     */
    public static void tick(MinecraftClient client) {
        if (client.options == null) return;

        double currentGamma = client.options.getGamma().getValue();

        if (NovaConfig.fullBright) {
            if (originalGamma < 0 && currentGamma < 10) {
                originalGamma = currentGamma;
            }
            if (currentGamma < 15.0) {
                client.options.getGamma().setValue(15.0);
            }
        } else {
            if (originalGamma >= 0) {
                client.options.getGamma().setValue(originalGamma);
                originalGamma = -1;
            }
        }
    }
}
