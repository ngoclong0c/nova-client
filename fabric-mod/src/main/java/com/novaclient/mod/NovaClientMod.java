package com.novaclient.mod;

import com.novaclient.mod.config.NovaConfig;
import com.novaclient.mod.feature.FullBright;
import com.novaclient.mod.feature.SprintToggle;
import com.novaclient.mod.feature.ZoomKey;
import com.novaclient.mod.hud.HudRenderer;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

/**
 * Nova Client Mod - Entry point.
 * Mod PvP & Sinh tồn cho Minecraft 1.21.x
 * Tính năng: HUD (Armor, Keystrokes, Coords, FPS, Direction),
 *            FullBright, Sprint Toggle, Zoom.
 */
public class NovaClientMod implements ClientModInitializer {

    public static final String MOD_ID = "nova-client";

    /** Phím R - Mở/đóng menu config */
    private static KeyBinding configKey;

    /** Phím C - Zoom camera */
    private static KeyBinding zoomKey;

    /** Phím G - Bật/tắt FullBright */
    private static KeyBinding fullbrightKey;

    /** Phím V - Bật/tắt Sprint Toggle */
    private static KeyBinding sprintKey;

    @Override
    public void onInitializeClient() {
        // Load config
        NovaConfig.load();

        // Đăng ký phím tắt
        configKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.nova-client.config", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_R, "category.nova-client"
        ));
        zoomKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.nova-client.zoom", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_C, "category.nova-client"
        ));
        fullbrightKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.nova-client.fullbright", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_G, "category.nova-client"
        ));
        sprintKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.nova-client.sprint", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_V, "category.nova-client"
        ));

        // Đăng ký HUD render
        HudRenderCallback.EVENT.register(HudRenderer::render);

        // Đăng ký tick events
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            // Phím R - toggle config menu hiển thị
            if (configKey.wasPressed()) {
                NovaConfig.showConfigScreen(client);
            }

            // Phím G - toggle FullBright
            if (fullbrightKey.wasPressed()) {
                NovaConfig.fullBright = !NovaConfig.fullBright;
                NovaConfig.save();
            }

            // Phím V - toggle Sprint
            if (sprintKey.wasPressed()) {
                NovaConfig.sprintToggle = !NovaConfig.sprintToggle;
                NovaConfig.save();
            }

            // Áp dụng features mỗi tick
            FullBright.tick(client);
            SprintToggle.tick(client);
            ZoomKey.tick(client, zoomKey);
        });

        System.out.println("[Nova Client] Mod đã khởi tạo thành công!");
    }
}
