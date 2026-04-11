package com.novaclient.mod.hud;

import com.novaclient.mod.config.NovaConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.ItemStack;

/**
 * Armor Status HUD - Hiển thị 4 slot giáp + vũ khí tay cùng độ bền.
 * Vị trí: góc phải màn hình.
 */
public class ArmorHud {

    /**
     * Render armor status ở góc phải.
     * @param drawContext Context vẽ
     * @param client Minecraft client
     */
    public static void render(DrawContext drawContext, MinecraftClient client) {
        if (!NovaConfig.armorHud || client.player == null) return;

        PlayerEntity player = client.player;
        int screenWidth = client.getWindow().getScaledWidth();
        int x = screenWidth - 60;
        int y = 4;

        // Vẽ nền mờ
        drawContext.fill(x - 4, y - 2, screenWidth - 2, y + 5 * 18 + 2, 0x80000000);

        // Hiển thị từng item giáp (từ mũ → giày) + vũ khí tay chính
        for (int i = 3; i >= 0; i--) {
            ItemStack stack = player.getInventory().getArmorStack(i);
            if (!stack.isEmpty()) {
                drawContext.drawItem(stack, x, y);
                drawDurability(drawContext, client, stack, x + 18, y + 4);
            }
            y += 18;
        }

        // Vũ khí tay chính
        ItemStack mainHand = player.getMainHandStack();
        if (!mainHand.isEmpty()) {
            drawContext.drawItem(mainHand, x, y);
            drawDurability(drawContext, client, mainHand, x + 18, y + 4);
        }
    }

    /**
     * Vẽ text độ bền với màu sắc tương ứng.
     */
    private static void drawDurability(DrawContext ctx, MinecraftClient client, ItemStack stack, int x, int y) {
        if (stack.getMaxDamage() <= 0) return;

        int current = stack.getMaxDamage() - stack.getDamage();
        int max = stack.getMaxDamage();
        float ratio = (float) current / max;

        // Màu theo độ bền: xanh (>50%), vàng (>25%), đỏ (<=25%)
        int color;
        if (ratio > 0.5f) color = 0xFF55FF55;
        else if (ratio > 0.25f) color = 0xFFFFFF55;
        else color = 0xFFFF5555;

        String text = current + "";
        ctx.drawText(client.textRenderer, text, x, y, color, true);
    }
}
