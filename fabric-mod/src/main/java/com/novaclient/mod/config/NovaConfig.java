package com.novaclient.mod.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.option.SimpleOptionsScreen;
import net.minecraft.text.Text;

import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;

/**
 * Cấu hình Nova Client - lưu trạng thái bật/tắt từng module.
 * File config: .minecraft/config/nova-client.json
 */
public class NovaConfig {

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final File CONFIG_FILE = FabricLoader.getInstance()
            .getConfigDir().resolve("nova-client.json").toFile();

    // === HUD Modules ===
    /** Hiển thị giáp + độ bền */
    public static boolean armorHud = true;

    /** Hiển thị phím W/A/S/D + CPS */
    public static boolean keystrokesHud = true;

    /** Hiển thị tọa độ X/Y/Z */
    public static boolean coordinatesHud = true;

    /** Hiển thị FPS */
    public static boolean fpsHud = true;

    /** Hiển thị hướng nhìn */
    public static boolean directionHud = true;

    // === Features ===
    /** Fullbright - nhìn tối như sáng */
    public static boolean fullBright = false;

    /** Auto-sprint toggle */
    public static boolean sprintToggle = false;

    /** Zoom đang được giữ */
    public static boolean zoomActive = false;

    /**
     * Load config từ file. Nếu chưa có file thì tạo mới với giá trị mặc định.
     */
    public static void load() {
        if (CONFIG_FILE.exists()) {
            try (FileReader reader = new FileReader(CONFIG_FILE)) {
                ConfigData data = GSON.fromJson(reader, ConfigData.class);
                if (data != null) {
                    armorHud = data.armorHud;
                    keystrokesHud = data.keystrokesHud;
                    coordinatesHud = data.coordinatesHud;
                    fpsHud = data.fpsHud;
                    directionHud = data.directionHud;
                    fullBright = data.fullBright;
                    sprintToggle = data.sprintToggle;
                }
            } catch (Exception e) {
                System.err.println("[Nova Client] Lỗi đọc config: " + e.getMessage());
            }
        } else {
            save();
        }
    }

    /**
     * Lưu config ra file JSON.
     */
    public static void save() {
        try {
            CONFIG_FILE.getParentFile().mkdirs();
            try (FileWriter writer = new FileWriter(CONFIG_FILE)) {
                ConfigData data = new ConfigData();
                data.armorHud = armorHud;
                data.keystrokesHud = keystrokesHud;
                data.coordinatesHud = coordinatesHud;
                data.fpsHud = fpsHud;
                data.directionHud = directionHud;
                data.fullBright = fullBright;
                data.sprintToggle = sprintToggle;
                GSON.toJson(data, writer);
            }
        } catch (Exception e) {
            System.err.println("[Nova Client] Lỗi lưu config: " + e.getMessage());
        }
    }

    /**
     * Hiển thị màn hình config đơn giản (toggle từng module).
     * Nhấn R trong game để mở.
     */
    public static void showConfigScreen(MinecraftClient client) {
        // Toggle tất cả HUD khi nhấn R (đơn giản)
        boolean allOn = armorHud && keystrokesHud && coordinatesHud && fpsHud && directionHud;
        if (allOn) {
            armorHud = false;
            keystrokesHud = false;
            coordinatesHud = false;
            fpsHud = false;
            directionHud = false;
        } else {
            armorHud = true;
            keystrokesHud = true;
            coordinatesHud = true;
            fpsHud = true;
            directionHud = true;
        }
        save();

        // Hiện thông báo trạng thái trên chat
        String status = armorHud ? "§aBẬT" : "§cTẮT";
        if (client.player != null) {
            client.player.sendMessage(Text.of("§7[§bNova§7] HUD: " + status), true);
        }
    }

    /** Cấu trúc dữ liệu để serialize/deserialize JSON */
    private static class ConfigData {
        boolean armorHud = true;
        boolean keystrokesHud = true;
        boolean coordinatesHud = true;
        boolean fpsHud = true;
        boolean directionHud = true;
        boolean fullBright = false;
        boolean sprintToggle = false;
    }
}
