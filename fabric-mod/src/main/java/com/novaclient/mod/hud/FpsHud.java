package com.novaclient.mod.hud;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * FPS Counter HUD - Hiển thị FPS hiện tại ở góc trên trái.
 */
public class FpsHud {

    /**
     * Render FPS counter.
     * @param drawContext Context vẽ
     * @param x Vị trí X
     * @param y Vị trí Y
     * @return Y tiếp theo để render module kế
     */
    public static int render(DrawContext drawContext, int x, int y) {
        if (!NovaConfig.fpsHud) return y;

        MinecraftClient client = MinecraftClient.getInstance();
        int fps = client.getCurrentFps();

        // Màu theo FPS: xanh lá (>=60), vàng (>=30), đỏ (<30)
        int color;
        if (fps >= 60) color = 0xFF55FF55;      // Xanh lá
        else if (fps >= 30) color = 0xFFFFFF55;  // Vàng
        else color = 0xFFFF5555;                  // Đỏ

        String text = fps + " FPS";

        // Nền mờ
        drawContext.fill(x - 2, y - 1, x + client.textRenderer.getWidth(text) + 3, y + 10, 0x80000000);
        drawContext.drawText(client.textRenderer, text, x, y, color, true);

        return y + 12;
    }
}
