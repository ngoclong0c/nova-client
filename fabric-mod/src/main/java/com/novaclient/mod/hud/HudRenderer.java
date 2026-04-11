package com.novaclient.mod.hud;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.RenderTickCounter;

/**
 * HUD Renderer chính - gọi tất cả các module HUD.
 * Được đăng ký vào HudRenderCallback từ NovaClientMod.
 */
public class HudRenderer {

    /**
     * Render tất cả HUD overlay mỗi frame.
     * @param drawContext Context vẽ của Minecraft
     * @param tickCounter Tick counter cho animation
     */
    public static void render(DrawContext drawContext, RenderTickCounter tickCounter) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null || client.options.hudHidden) return;

        int y = 4; // Vị trí Y bắt đầu (góc trên trái)

        // FPS Counter
        y = FpsHud.render(drawContext, 4, y);

        // Coordinates
        y = CoordinatesHud.render(drawContext, 4, y, client);

        // Direction
        y = DirectionHud.render(drawContext, 4, y, client);

        // Keystrokes (góc dưới trái)
        KeystrokesHud.render(drawContext, client);

        // Armor Status (góc phải)
        ArmorHud.render(drawContext, client);
    }
}
