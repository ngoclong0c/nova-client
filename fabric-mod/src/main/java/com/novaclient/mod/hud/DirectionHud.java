package com.novaclient.mod.hud;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * Direction HUD - Hiển thị hướng nhìn (Bắc/Nam/Đông/Tây).
 */
public class DirectionHud {

    /**
     * Render hướng nhìn.
     * @param drawContext Context vẽ
     * @param x Vị trí X
     * @param y Vị trí Y
     * @param client Minecraft client
     * @return Y tiếp theo
     */
    public static int render(DrawContext drawContext, int x, int y, MinecraftClient client) {
        if (!NovaConfig.directionHud || client.player == null) return y;

        float yaw = client.player.getYaw() % 360;
        if (yaw < 0) yaw += 360;

        String direction;
        if (yaw >= 315 || yaw < 45) direction = "Nam (S)";
        else if (yaw >= 45 && yaw < 135) direction = "Tay (W)";
        else if (yaw >= 135 && yaw < 225) direction = "Bac (N)";
        else direction = "Dong (E)";

        String text = "Huong: " + direction;

        drawContext.fill(x - 2, y - 1, x + client.textRenderer.getWidth(text) + 3, y + 10, 0x80000000);
        drawContext.drawText(client.textRenderer, text, x, y, 0xFF55FFFF, true);

        return y + 12;
    }
}
