package com.novaclient.mod.hud;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * Coordinates HUD - Hiển thị tọa độ X/Y/Z của người chơi.
 */
public class CoordinatesHud {

    /**
     * Render tọa độ.
     * @param drawContext Context vẽ
     * @param x Vị trí X trên màn hình
     * @param y Vị trí Y trên màn hình
     * @param client Minecraft client instance
     * @return Y tiếp theo
     */
    public static int render(DrawContext drawContext, int x, int y, MinecraftClient client) {
        if (!NovaConfig.coordinatesHud || client.player == null) return y;

        int px = (int) client.player.getX();
        int py = (int) client.player.getY();
        int pz = (int) client.player.getZ();

        String text = "XYZ: " + px + " / " + py + " / " + pz;

        // Nền mờ
        drawContext.fill(x - 2, y - 1, x + client.textRenderer.getWidth(text) + 3, y + 10, 0x80000000);
        drawContext.drawText(client.textRenderer, text, x, y, 0xFFFFFFFF, true);

        return y + 12;
    }
}
