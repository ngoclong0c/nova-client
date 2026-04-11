package com.novaclient.mod.hud;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.GameOptions;

/**
 * Keystrokes HUD - Hiển thị phím W/A/S/D và CPS (clicks per second).
 * Vị trí: góc dưới trái màn hình.
 */
public class KeystrokesHud {

    private static int leftClicks = 0;
    private static int rightClicks = 0;
    private static long lastSecond = 0;
    private static int leftCps = 0;
    private static int rightCps = 0;
    private static int tempLeftClicks = 0;
    private static int tempRightClicks = 0;
    private static boolean wasLeftPressed = false;
    private static boolean wasRightPressed = false;

    private static final int KEY_SIZE = 22;
    private static final int GAP = 2;

    /**
     * Render keystrokes + CPS.
     * @param drawContext Context vẽ
     * @param client Minecraft client
     */
    public static void render(DrawContext drawContext, MinecraftClient client) {
        if (!NovaConfig.keystrokesHud || client.player == null) return;

        GameOptions opts = client.options;
        int screenHeight = client.getWindow().getScaledHeight();

        // Vị trí góc dưới trái
        int baseX = 4;
        int baseY = screenHeight - 90;

        // Đếm CPS
        long now = System.currentTimeMillis();
        if (now - lastSecond >= 1000) {
            leftCps = tempLeftClicks;
            rightCps = tempRightClicks;
            tempLeftClicks = 0;
            tempRightClicks = 0;
            lastSecond = now;
        }

        boolean leftPressed = opts.attackKey.isPressed();
        boolean rightPressed = opts.useKey.isPressed();
        if (leftPressed && !wasLeftPressed) tempLeftClicks++;
        if (rightPressed && !wasRightPressed) tempRightClicks++;
        wasLeftPressed = leftPressed;
        wasRightPressed = rightPressed;

        // Row 1: W
        drawKey(drawContext, client, "W", baseX + KEY_SIZE + GAP, baseY, opts.forwardKey.isPressed());

        // Row 2: A S D
        int row2Y = baseY + KEY_SIZE + GAP;
        drawKey(drawContext, client, "A", baseX, row2Y, opts.leftKey.isPressed());
        drawKey(drawContext, client, "S", baseX + KEY_SIZE + GAP, row2Y, opts.backKey.isPressed());
        drawKey(drawContext, client, "D", baseX + (KEY_SIZE + GAP) * 2, row2Y, opts.rightKey.isPressed());

        // Row 3: LMB  RMB
        int row3Y = row2Y + KEY_SIZE + GAP;
        int halfW = (KEY_SIZE * 3 + GAP * 2 - GAP) / 2;
        drawWideKey(drawContext, client, "LMB " + leftCps, baseX, row3Y, halfW, leftPressed);
        drawWideKey(drawContext, client, "RMB " + rightCps, baseX + halfW + GAP, row3Y, halfW, rightPressed);
    }

    private static void drawKey(DrawContext ctx, MinecraftClient client, String label, int x, int y, boolean pressed) {
        int bg = pressed ? 0xCC4FC3F7 : 0x80000000;
        int textColor = pressed ? 0xFF000000 : 0xFFFFFFFF;
        ctx.fill(x, y, x + KEY_SIZE, y + KEY_SIZE, bg);
        int textX = x + (KEY_SIZE - client.textRenderer.getWidth(label)) / 2;
        int textY = y + (KEY_SIZE - 8) / 2;
        ctx.drawText(client.textRenderer, label, textX, textY, textColor, false);
    }

    private static void drawWideKey(DrawContext ctx, MinecraftClient client, String label, int x, int y, int width, boolean pressed) {
        int bg = pressed ? 0xCC4FC3F7 : 0x80000000;
        int textColor = pressed ? 0xFF000000 : 0xFFFFFFFF;
        ctx.fill(x, y, x + width, y + KEY_SIZE, bg);
        int textX = x + (width - client.textRenderer.getWidth(label)) / 2;
        int textY = y + (KEY_SIZE - 8) / 2;
        ctx.drawText(client.textRenderer, label, textX, textY, textColor, false);
    }
}
