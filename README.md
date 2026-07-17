# 鲨壁 Android

这是根据电脑版“鲨壁”和 `ShabiServer` 源码制作的 Android 视频动态壁纸客户端。手机端直接复用现有服务器，不需要修改服务端，也不需要在手机上安装 Steam 或 SteamCMD。

## 已实现

- 服务器设置：保存服务器 URL 和 `X-Shabi-Key`，并可测试 `/api/status`。
- Steam 下载：提交 `/api/jobs`、轮询进度、下载 `/api/files/{id}` 和 `/api/previews/{id}`。
- 本地壁纸库：视频和预览图保存在 App 私有目录，可下拉刷新、长按删除。
- 本地导入：从安卓文件选择器导入 MP4。
- 独立启用页：视频预览、显示方式、应用目标均与浏览页分开。
- 显示方式：裁切铺满、完整显示、拉伸铺满、用户自定义。
- 自定义模式：1.00–3.00 倍缩放，并可调整水平和垂直位置。
- 应用目标：桌面、锁屏、桌面和锁屏。
- 省电：壁纸不可见时暂停播放；所有动态壁纸默认静音。

## 安卓系统限制

Android 的公开动态壁纸接口会打开系统预览页，让用户最终确认。它没有向第三方 App 提供可强制指定“桌面/锁屏/两者”的公开参数，因此 App 会记住用户选择并显示对应提示，最后仍需在系统页面选择目标。

不同品牌手机对动态锁屏的支持不一致：有些设备支持桌面和锁屏，有些只能给桌面设置动态壁纸，也有些不支持“仅锁屏”。这不是服务端或 App 下载功能的问题。

## 开发环境

- Node.js 20 或更高版本
- Android Studio 与 Android SDK
- JDK 17
- Expo SDK 57 / React Native 0.86

此项目包含自定义 Android `WallpaperService`，不能用 Expo Go 测试，必须编译原生 App。

## 本机运行

```bash
npm ci
npx expo run:android
```

也可以直接用 Android Studio 打开生成后的 `android` 目录。

生成调试 APK：

```bash
cd android
./gradlew assembleRelease
```

可独立运行的 APK 输出到 `android/app/build/outputs/apk/release/app-release.apk`，JavaScript 会直接打包进 APK，不需要连接 Metro 开发服务器。

## 生成可分发版本

先创建自己的 Android 签名密钥，不要用项目里的调试密钥发布。配置 release signing 后执行：

```bash
cd android
./gradlew assembleRelease
```

也可以配置 Expo/EAS 后使用 `eas build --profile preview --platform android` 生成内部测试 APK。

## 首次使用

1. 安装 App，打开“设置”。
2. 填写与电脑版相同的远程服务器地址和访问密钥。
3. 点“测试连接”。
4. 在“下载”页粘贴 Steam 创意工坊链接。
5. 下载完成后进入“壁纸库”，点按壁纸进入“启用壁纸”页。
6. 设置显示方式和应用目标，再进入安卓系统预览确认。

## 安全

访问密钥通过 Expo SecureStore 保存，不写入源码、`.env` 或壁纸库 JSON。不要把服务器密钥放进截图或公开仓库；如果已经暴露，请先在 `ShabiServer` 配置中更换。

请只下载和使用你有权访问、保存与展示的创意工坊内容。
