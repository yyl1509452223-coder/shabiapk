import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  GestureResponderEvent,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { File } from 'expo-file-system';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView, type VideoContentFit } from 'expo-video';
import VideoWallpaper from './modules/video-wallpaper/src/VideoWallpaperModule';
import {
  apiHeaders,
  createJob,
  extractWorkshopId,
  fileUrl,
  getJob,
  normalizeServerUrl,
  previewUrl,
  testServer,
} from './src/shabiApi';
import {
  deleteWallpaperFiles,
  importLocalVideo,
  loadLibrary,
  loadServerSettings,
  previewDestination,
  saveLibrary,
  saveServerSettings,
  videoDestination,
} from './src/storage';
import type {
  ScaleMode,
  ServerSettings,
  WallpaperItem,
  WallpaperOptions,
  WallpaperTarget,
} from './src/types';

type Tab = 'download' | 'library' | 'settings';

const colors = {
  background: '#F6F3FB',
  panel: '#FFFFFF',
  panelSoft: '#F0ECF7',
  text: '#211B32',
  muted: '#7E768F',
  line: '#E7E0F0',
  primary: '#7356E8',
  primaryDark: '#4B2E94',
  purpleSoft: '#EEE8FF',
  green: '#159B65',
  greenSoft: '#E4F7EE',
  red: '#D94C58',
  redSoft: '#FDECEE',
  black: '#0D0B13',
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试。';
}

function formatBytes(bytes?: number) {
  if (!bytes || bytes < 1) return '大小未知';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function PageHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return (
    <LinearGradient colors={[colors.primaryDark, colors.primary]} style={styles.pageHeader}>
      <View style={styles.pageHeaderRow}>
        {onBack ? (
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.logoMark}><Text style={styles.logoGlyph}>鲨</Text></View>
        )}
        <View style={styles.flex}>
          <Text style={styles.pageTitle}>{title}</Text>
          {!!subtitle && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
        </View>
      </View>
    </LinearGradient>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, value))}%` }]} />
    </View>
  );
}

function DownloadScreen({
  settings,
  onNeedSettings,
  onDownloaded,
  onOpenLibrary,
}: {
  settings: ServerSettings;
  onNeedSettings: () => void;
  onDownloaded: (item: WallpaperItem) => Promise<void>;
  onOpenLibrary: () => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('粘贴 Steam 创意工坊链接或输入 Workshop ID。');

  const download = async () => {
    if (!settings.serverUrl || !settings.accessKey) {
      Alert.alert('先连接服务器', '请先保存下载服务器地址和访问密钥。', [
        { text: '取消', style: 'cancel' },
        { text: '去设置', onPress: onNeedSettings },
      ]);
      return;
    }
    const workshopId = extractWorkshopId(input);
    if (!workshopId) {
      Alert.alert('链接不正确', '请输入有效的创意工坊详情页链接或 6–20 位 Workshop ID。');
      return;
    }

    setBusy(true);
    setProgress(3);
    setStatus('正在提交远程下载任务…');
    try {
      let job = await createJob(settings, workshopId);
      for (let attempt = 0; attempt < 3600 && job.status !== 'ready'; attempt += 1) {
        if (job.status === 'failed') throw new Error(job.message || '服务器下载失败。');
        setProgress(Math.max(5, Math.min(95, job.progress || 5)));
        setStatus(job.message || '服务器正在下载壁纸…');
        await sleep(1000);
        job = await getJob(settings, workshopId);
      }
      if (job.status !== 'ready') throw new Error('等待服务器超时，请稍后重新打开任务。');

      const video = videoDestination(workshopId);
      if (video.exists) video.delete();
      setProgress(96);
      setStatus('服务器已准备好，正在传输 MP4…');
      const task = File.createDownloadTask(fileUrl(settings, workshopId), video, {
        headers: apiHeaders(settings),
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) setProgress(96 + Math.min(3, (bytesWritten / totalBytes) * 3));
        },
      });
      await task.downloadAsync();

      let previewUri: string | undefined;
      const preview = previewDestination(workshopId);
      if (preview.exists) preview.delete();
      try {
        await File.downloadFileAsync(previewUrl(settings, workshopId), preview, {
          headers: apiHeaders(settings),
          idempotent: true,
        });
        if (preview.exists) previewUri = preview.uri;
      } catch {
        if (preview.exists) preview.delete();
      }

      const item: WallpaperItem = {
        id: `steam-${workshopId}`,
        workshopId,
        title: job.title?.trim() || `Steam 壁纸 ${workshopId}`,
        source: 'steam',
        videoUri: video.uri,
        previewUri,
        fileSize: video.size,
        addedAt: new Date().toISOString(),
      };
      await onDownloaded(item);
      setProgress(100);
      setStatus('下载完成，已经加入壁纸库。');
      setInput('');
      Alert.alert('下载完成', '视频壁纸已经加入本机壁纸库。', [
        { text: '继续下载' },
        { text: '去壁纸库', onPress: onOpenLibrary },
      ]);
    } catch (error) {
      setStatus(messageOf(error));
      Alert.alert('下载失败', messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <PageHeader title="远程下载" subtitle="让你的电脑服务器代为下载 Steam 视频壁纸" />
      <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
        <View style={styles.noticeSuccess}>
          <View style={styles.noticeDot} />
          <Text style={styles.noticeSuccessText}>手机不需要安装 Steam 或 SteamCMD。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>创意工坊壁纸</Text>
          <Text style={styles.sectionCaption}>支持详情页链接，也可以直接输入 Workshop ID。</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            multiline
            onChangeText={setInput}
            placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
            placeholderTextColor="#A39BAF"
            style={[styles.input, styles.urlInput]}
            value={input}
          />
          <Pressable
            disabled={busy}
            onPress={() => void download()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>下载壁纸</Text>}
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.statusHeader}>
            <Text style={styles.sectionTitle}>下载状态</Text>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
          <ProgressBar value={progress} />
          <Text style={[styles.sectionCaption, styles.statusMessage]}>{status}</Text>
        </View>

        <View style={styles.cardMuted}>
          <Text style={styles.tipTitle}>下载流程</Text>
          <Text style={styles.tipText}>服务器从创意工坊下载并找到视频文件 → 手机接收 MP4 和预览图 → 自动加入本地壁纸库。</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function EmptyLibrary({ onImport }: { onImport: () => void }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}><Text style={styles.emptyIconText}>▶</Text></View>
      <Text style={styles.emptyTitle}>还没有视频壁纸</Text>
      <Text style={styles.emptyCaption}>从 Steam 下载，或者导入手机里已有的 MP4。</Text>
      <Pressable onPress={onImport} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>导入本地 MP4</Text>
      </Pressable>
    </View>
  );
}

function WallpaperCard({
  item,
  onPress,
  onLongPress,
}: {
  item: WallpaperItem;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      delayLongPress={500}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.wallpaperCard, pressed && styles.pressed]}
    >
      <View style={styles.thumbnailBox}>
        {item.previewUri ? (
          <Image resizeMode="cover" source={{ uri: item.previewUri }} style={styles.thumbnail} />
        ) : (
          <LinearGradient colors={['#4B2E94', '#8F72F4']} style={styles.thumbnailPlaceholder}>
            <Text style={styles.thumbnailGlyph}>▶</Text>
          </LinearGradient>
        )}
        <View style={styles.sourceBadge}>
          <Text style={styles.sourceBadgeText}>{item.source === 'steam' ? 'STEAM' : '本地'}</Text>
        </View>
      </View>
      <Text numberOfLines={1} style={styles.wallpaperTitle}>{item.title}</Text>
      <Text numberOfLines={1} style={styles.wallpaperMeta}>{formatBytes(item.fileSize)} · 点按启用</Text>
    </Pressable>
  );
}

function LibraryScreen({
  items,
  refreshing,
  onRefresh,
  onSelect,
  onImport,
  onDelete,
}: {
  items: WallpaperItem[];
  refreshing: boolean;
  onRefresh: () => void;
  onSelect: (item: WallpaperItem) => void;
  onImport: () => void;
  onDelete: (item: WallpaperItem) => void;
}) {
  return (
    <View style={styles.flex}>
      <PageHeader title="壁纸库" subtitle="浏览壁纸；点按后进入单独的启用设置页" />
      <View style={styles.libraryToolbar}>
        <View>
          <Text style={styles.libraryCount}>{items.length} 张壁纸</Text>
          <Text style={styles.toolbarCaption}>长按卡片可以删除本机文件</Text>
        </View>
        <Pressable onPress={onImport} style={styles.smallPrimaryButton}>
          <Text style={styles.smallPrimaryButtonText}>＋ 本地 MP4</Text>
        </Pressable>
      </View>
      <FlatList
        ListEmptyComponent={<EmptyLibrary onImport={onImport} />}
        columnWrapperStyle={items.length > 0 ? styles.libraryRow : undefined}
        contentContainerStyle={[styles.libraryList, items.length === 0 && styles.libraryListEmpty]}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <WallpaperCard item={item} onLongPress={() => onDelete(item)} onPress={() => onSelect(item)} />
        )}
      />
    </View>
  );
}

function SettingsScreen({
  settings,
  onSaved,
}: {
  settings: ServerSettings;
  onSaved: (settings: ServerSettings) => void;
}) {
  const [serverUrl, setServerUrl] = useState(settings.serverUrl);
  const [accessKey, setAccessKey] = useState(settings.accessKey);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setServerUrl(settings.serverUrl);
    setAccessKey(settings.accessKey);
  }, [settings]);

  const draft = () => ({ serverUrl: normalizeServerUrl(serverUrl), accessKey: accessKey.trim() });

  const save = async () => {
    try {
      const value = draft();
      if (!value.accessKey) throw new Error('请填写访问密钥。');
      await saveServerSettings(value);
      onSaved(value);
      setConnected(false);
      Alert.alert('已保存', '服务器配置已经安全保存在这台手机上。');
    } catch (error) {
      Alert.alert('无法保存', messageOf(error));
    }
  };

  const test = async () => {
    setBusy(true);
    setConnected(false);
    try {
      const value = draft();
      await testServer(value);
      await saveServerSettings(value);
      onSaved(value);
      setConnected(true);
      Alert.alert('连接成功', '鲨壁下载服务器可以使用。');
    } catch (error) {
      Alert.alert('连接失败', messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <PageHeader title="服务器设置" subtitle="连接你现有的 ShabiServer 远程下载服务" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.pageContent} keyboardShouldPersistTaps="handled">
          {connected && (
            <View style={styles.noticeSuccess}>
              <View style={styles.noticeDot} />
              <Text style={styles.noticeSuccessText}>连接成功，下载服务器可以使用。</Text>
            </View>
          )}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>服务器地址</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setServerUrl}
              placeholder="https://你的服务器地址"
              placeholderTextColor="#A39BAF"
              style={styles.input}
              value={serverUrl}
            />
            <Text style={styles.fieldLabel}>访问密钥</Text>
            <View style={styles.keyRow}>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                onChangeText={setAccessKey}
                placeholder="X-Shabi-Key"
                placeholderTextColor="#A39BAF"
                secureTextEntry={!showKey}
                style={[styles.input, styles.keyInput]}
                value={accessKey}
              />
              <Pressable onPress={() => setShowKey((value) => !value)} style={styles.showKeyButton}>
                <Text style={styles.showKeyText}>{showKey ? '隐藏' : '显示'}</Text>
              </Pressable>
            </View>
            <View style={styles.buttonRow}>
              <Pressable disabled={busy} onPress={() => void save()} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>保存</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => void test()} style={[styles.primaryButton, styles.flexButton, busy && styles.disabled]}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>测试连接</Text>}
              </Pressable>
            </View>
          </View>

          <View style={styles.cardMuted}>
            <Text style={styles.tipTitle}>与电脑版共用服务器</Text>
            <Text style={styles.tipText}>App 会调用 /api/status、/api/jobs、/api/files 和 /api/previews，并在每次请求中发送 X-Shabi-Key。</Text>
          </View>
          <View style={styles.securityCard}>
            <Text style={styles.securityTitle}>密钥安全</Text>
            <Text style={styles.securityText}>访问密钥不会写进壁纸库或源码。若密钥曾出现在公开截图里，请在服务器上更换后再填入这里。</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ChoiceButton<T extends string>({
  active,
  label,
  caption,
  value,
  onChange,
}: {
  active: boolean;
  label: string;
  caption?: string;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Pressable onPress={() => onChange(value)} style={[styles.choiceButton, active && styles.choiceButtonActive]}>
      <View style={[styles.radio, active && styles.radioActive]}>{active && <View style={styles.radioDot} />}</View>
      <View style={styles.flex}>
        <Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>{label}</Text>
        {!!caption && <Text style={styles.choiceCaption}>{caption}</Text>}
      </View>
    </Pressable>
  );
}

function ValueSlider({
  label,
  value,
  minimum,
  maximum,
  onChange,
  format,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  const [trackWidth, setTrackWidth] = useState(1);
  const ratio = (value - minimum) / (maximum - minimum);
  const update = (event: GestureResponderEvent) => {
    const nextRatio = Math.max(0, Math.min(1, event.nativeEvent.locationX / trackWidth));
    onChange(minimum + nextRatio * (maximum - minimum));
  };
  return (
    <View style={styles.sliderBlock}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{format(value)}</Text>
      </View>
      <View
        accessibilityRole="adjustable"
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={update}
        onResponderMove={update}
        onStartShouldSetResponder={() => true}
        style={styles.sliderTouch}
      >
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, { width: `${ratio * 100}%` }]} />
          <View style={[styles.sliderThumb, { left: `${ratio * 100}%` }]} />
        </View>
      </View>
    </View>
  );
}

function WallpaperPreview({
  uri,
  scaleMode,
  zoom,
  offsetX,
  offsetY,
}: {
  uri: string;
  scaleMode: ScaleMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });
  const contentFit: VideoContentFit = scaleMode === 'contain' ? 'contain' : scaleMode === 'stretch' ? 'fill' : 'cover';
  return (
    <View style={styles.phonePreview}>
      <VideoView
        contentFit={contentFit}
        nativeControls={false}
        player={player}
        surfaceType="textureView"
        style={[
          styles.previewVideo,
          scaleMode === 'custom' && {
            transform: [
              { translateX: offsetX * 56 },
              { translateY: offsetY * 90 },
              { scale: zoom },
            ],
          },
        ]}
      />
      <View pointerEvents="none" style={styles.previewClock}>
        <Text style={styles.previewTime}>12:08</Text>
        <Text style={styles.previewDate}>7月17日 · 星期五</Text>
      </View>
    </View>
  );
}

const scaleModes: Array<{ value: ScaleMode; label: string; caption: string }> = [
  { value: 'cover', label: '裁切铺满', caption: '保持比例，裁去多余边缘' },
  { value: 'contain', label: '完整显示', caption: '保持比例，可能出现黑边' },
  { value: 'stretch', label: '拉伸铺满', caption: '填满屏幕，画面可能变形' },
  { value: 'custom', label: '用户自定义', caption: '缩放并调整画面中心位置' },
];

const targets: Array<{ value: WallpaperTarget; label: string; caption: string }> = [
  { value: 'home', label: '桌面', caption: '系统确认页选择主屏幕' },
  { value: 'lock', label: '锁屏', caption: '是否支持取决于手机系统' },
  { value: 'both', label: '桌面和锁屏', caption: '在系统确认页选择两者' },
];

function EnableScreen({ item, onBack }: { item: WallpaperItem; onBack: () => void }) {
  const [scaleMode, setScaleMode] = useState<ScaleMode>('cover');
  const [target, setTarget] = useState<WallpaperTarget>('home');
  const [zoom, setZoom] = useState(1.15);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [busy, setBusy] = useState(false);

  const openSystemPreview = async () => {
    setBusy(true);
    try {
      if (Platform.OS !== 'android' || !VideoWallpaper.isSupported()) {
        throw new Error('这台设备不支持 Android 动态壁纸。');
      }
      const options: WallpaperOptions = { uri: item.videoUri, scaleMode, zoom, offsetX, offsetY, target };
      await VideoWallpaper.setVideoWallpaper(
        options.uri,
        options.scaleMode,
        options.zoom,
        options.offsetX,
        options.offsetY,
        options.target,
      );
    } catch (error) {
      Alert.alert('无法打开动态壁纸', messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const targetName = targets.find((itemTarget) => itemTarget.value === target)?.label ?? '桌面';
    Alert.alert(
      '接下来由安卓系统确认',
      `已选择“${targetName}”。进入系统预览后，请点“设置壁纸”，再选择对应目标。部分手机不支持只给锁屏设置动态壁纸。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '打开系统预览', onPress: () => void openSystemPreview() },
      ],
    );
  };

  return (
    <View style={styles.flex}>
      <PageHeader title="启用壁纸" subtitle={item.title} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.enableContent}>
        <WallpaperPreview
          offsetX={offsetX}
          offsetY={offsetY}
          scaleMode={scaleMode}
          uri={item.videoUri}
          zoom={zoom}
        />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>画面显示方式</Text>
          <Text style={styles.sectionCaption}>这里的设置会直接用于系统动态壁纸播放。</Text>
          <View style={styles.choiceGrid}>
            {scaleModes.map((mode) => (
              <ChoiceButton
                active={scaleMode === mode.value}
                caption={mode.caption}
                key={mode.value}
                label={mode.label}
                onChange={setScaleMode}
                value={mode.value}
              />
            ))}
          </View>
          {scaleMode === 'custom' && (
            <View style={styles.customPanel}>
              <ValueSlider format={(value) => `${value.toFixed(2)}×`} label="缩放" maximum={3} minimum={1} onChange={setZoom} value={zoom} />
              <ValueSlider format={(value) => `${Math.round(value * 100)}%`} label="左右位置" maximum={1} minimum={-1} onChange={setOffsetX} value={offsetX} />
              <ValueSlider format={(value) => `${Math.round(value * 100)}%`} label="上下位置" maximum={1} minimum={-1} onChange={setOffsetY} value={offsetY} />
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>应用位置</Text>
          <Text style={styles.sectionCaption}>安卓会在最后一步显示系统确认页。</Text>
          <View style={styles.choiceGrid}>
            {targets.map((itemTarget) => (
              <ChoiceButton
                active={target === itemTarget.value}
                caption={itemTarget.caption}
                key={itemTarget.value}
                label={itemTarget.label}
                onChange={setTarget}
                value={itemTarget.value}
              />
            ))}
          </View>
        </View>

        <Pressable disabled={busy} onPress={apply} style={[styles.applyButton, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.applyButtonText}>打开系统预览并启用</Text>}
        </Pressable>
        <Text style={styles.systemNote}>动态壁纸默认静音，并会在桌面不可见时暂停播放以节省电量。</Text>
      </ScrollView>
    </View>
  );
}

function BottomNavigation({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const items: Array<{ value: Tab; glyph: string; label: string }> = [
    { value: 'download', glyph: '⇩', label: '下载' },
    { value: 'library', glyph: '▦', label: '壁纸库' },
    { value: 'settings', glyph: '⚙', label: '设置' },
  ];
  return (
    <View style={styles.bottomNavigation}>
      {items.map((item) => (
        <Pressable key={item.value} onPress={() => onChange(item.value)} style={styles.navButton}>
          <Text style={[styles.navGlyph, tab === item.value && styles.navActive]}>{item.glyph}</Text>
          <Text style={[styles.navLabel, tab === item.value && styles.navActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('download');
  const [settings, setSettings] = useState<ServerSettings>({ serverUrl: '', accessKey: '' });
  const [library, setLibrary] = useState<WallpaperItem[]>([]);
  const [selected, setSelected] = useState<WallpaperItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshLibrary = useCallback(async () => {
    setRefreshing(true);
    try {
      setLibrary(await loadLibrary());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [savedSettings, savedLibrary] = await Promise.all([loadServerSettings(), loadLibrary()]);
      setSettings(savedSettings);
      setLibrary(savedLibrary);
      if (!savedSettings.serverUrl || !savedSettings.accessKey) setTab('settings');
      setReady(true);
    })();
  }, []);

  const addWallpaper = async (item: WallpaperItem) => {
    const current = await loadLibrary();
    const next = [item, ...current.filter((existing) => existing.id !== item.id)];
    await saveLibrary(next);
    setLibrary(next);
  };

  const importVideo = async () => {
    try {
      const item = await importLocalVideo();
      if (!item) return;
      await addWallpaper(item);
      setTab('library');
    } catch (error) {
      Alert.alert('导入失败', messageOf(error));
    }
  };

  const removeWallpaper = (item: WallpaperItem) => {
    Alert.alert('删除本机壁纸？', `将删除“${item.title}”的视频文件和预览图。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteWallpaperFiles(item);
          setLibrary((current) => {
            const next = current.filter((candidate) => candidate.id !== item.id);
            void saveLibrary(next);
            return next;
          });
        },
      },
    ]);
  };

  if (!ready) {
    return (
      <View style={styles.loadingScreen}>
        <LinearGradient colors={[colors.primaryDark, colors.primary]} style={styles.loadingLogo}>
          <Text style={styles.loadingLogoText}>鲨</Text>
        </LinearGradient>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.loadingText}>正在打开鲨壁…</Text>
        <StatusBar style="dark" />
      </View>
    );
  }

  if (selected) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <EnableScreen item={selected} onBack={() => setSelected(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.flex}>
        {tab === 'download' && (
          <DownloadScreen
            onDownloaded={addWallpaper}
            onNeedSettings={() => setTab('settings')}
            onOpenLibrary={() => setTab('library')}
            settings={settings}
          />
        )}
        {tab === 'library' && (
          <LibraryScreen
            items={library}
            onDelete={removeWallpaper}
            onImport={() => void importVideo()}
            onRefresh={() => void refreshLibrary()}
            onSelect={setSelected}
            refreshing={refreshing}
          />
        )}
        {tab === 'settings' && <SettingsScreen onSaved={setSettings} settings={settings} />}
        <BottomNavigation onChange={setTab} tab={tab} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.primaryDark },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: 18 },
  loadingLogo: { width: 76, height: 76, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  loadingLogoText: { color: '#FFFFFF', fontSize: 36, fontWeight: '900' },
  loadingText: { color: colors.muted, fontSize: 14 },
  pageHeader: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 18 },
  pageHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoMark: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  logoGlyph: { color: '#FFFFFF', fontWeight: '900', fontSize: 21 },
  backButton: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  backGlyph: { color: '#FFFFFF', fontSize: 39, lineHeight: 38, marginTop: -2 },
  pageTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '800' },
  pageSubtitle: { color: '#E3DDF8', fontSize: 12, marginTop: 3 },
  pageContent: { padding: 16, paddingBottom: 34, backgroundColor: colors.background, gap: 14 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 18, padding: 16 },
  cardMuted: { backgroundColor: colors.panelSoft, borderRadius: 16, padding: 16 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sectionCaption: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  input: { minHeight: 50, borderWidth: 1.5, borderColor: '#DED5EB', borderRadius: 13, backgroundColor: '#FCFAFE', paddingHorizontal: 14, color: colors.text, fontSize: 14, marginTop: 9 },
  urlInput: { minHeight: 92, paddingTop: 13, textAlignVertical: 'top' },
  primaryButton: { minHeight: 50, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 12, paddingHorizontal: 18 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.55 },
  noticeSuccess: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: colors.greenSoft, borderRadius: 13 },
  noticeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  noticeSuccessText: { color: '#176B4C', fontSize: 13, flex: 1 },
  statusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  progressTrack: { height: 9, backgroundColor: '#EAE4F1', borderRadius: 99, overflow: 'hidden', marginTop: 14 },
  progressFill: { height: '100%', borderRadius: 99, backgroundColor: colors.primary },
  statusMessage: { marginTop: 10 },
  tipTitle: { color: colors.primaryDark, fontSize: 14, fontWeight: '800' },
  tipText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 5 },
  libraryToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 15, paddingBottom: 11, backgroundColor: colors.background },
  libraryCount: { color: colors.text, fontSize: 16, fontWeight: '800' },
  toolbarCaption: { color: colors.muted, fontSize: 11, marginTop: 2 },
  smallPrimaryButton: { height: 38, borderRadius: 12, backgroundColor: colors.primary, justifyContent: 'center', paddingHorizontal: 13 },
  smallPrimaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  libraryList: { paddingHorizontal: 12, paddingBottom: 30, backgroundColor: colors.background },
  libraryListEmpty: { flexGrow: 1 },
  libraryRow: { gap: 10 },
  wallpaperCard: { width: '48.5%', minWidth: 0, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 15, padding: 7, marginBottom: 10 },
  thumbnailBox: { width: '100%', aspectRatio: 1.24, borderRadius: 11, overflow: 'hidden', backgroundColor: colors.panelSoft },
  thumbnail: { width: '100%', height: '100%' },
  thumbnailPlaceholder: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  thumbnailGlyph: { color: '#FFFFFF', fontSize: 25, opacity: 0.9 },
  sourceBadge: { position: 'absolute', left: 7, top: 7, borderRadius: 7, backgroundColor: '#171222CC', paddingHorizontal: 6, paddingVertical: 4 },
  sourceBadgeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  wallpaperTitle: { color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 8, marginHorizontal: 3 },
  wallpaperMeta: { color: colors.muted, fontSize: 10, marginTop: 3, marginHorizontal: 3, marginBottom: 3 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, paddingBottom: 50 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.purpleSoft },
  emptyIconText: { color: colors.primary, fontSize: 26 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 18 },
  emptyCaption: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  secondaryButton: { height: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  secondaryButtonText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: '700', marginTop: 8 },
  keyRow: { flexDirection: 'row', gap: 8 },
  keyInput: { flex: 1 },
  showKeyButton: { width: 60, height: 50, marginTop: 9, borderRadius: 13, backgroundColor: colors.panelSoft, alignItems: 'center', justifyContent: 'center' },
  showKeyText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  buttonRow: { flexDirection: 'row', gap: 9, marginTop: 2 },
  outlineButton: { height: 50, minWidth: 92, marginTop: 12, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  outlineButtonText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  flexButton: { flex: 1 },
  securityCard: { backgroundColor: colors.redSoft, borderRadius: 16, padding: 16 },
  securityTitle: { color: '#9B2732', fontSize: 14, fontWeight: '800' },
  securityText: { color: '#8F4850', fontSize: 12, lineHeight: 19, marginTop: 5 },
  choiceGrid: { gap: 9, marginTop: 13 },
  choiceButton: { minHeight: 62, borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#FCFBFE', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
  choiceButtonActive: { borderColor: colors.primary, backgroundColor: colors.purpleSoft },
  radio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, borderColor: '#B4A9C2', alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  choiceLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  choiceLabelActive: { color: colors.primaryDark },
  choiceCaption: { color: colors.muted, fontSize: 11, marginTop: 2 },
  customPanel: { marginTop: 12, padding: 13, borderRadius: 14, backgroundColor: '#F7F3FD', gap: 10 },
  sliderBlock: { gap: 4 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  sliderValue: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  sliderTouch: { height: 30, justifyContent: 'center' },
  sliderTrack: { height: 5, borderRadius: 99, backgroundColor: '#D8D0E5' },
  sliderFill: { height: 5, borderRadius: 99, backgroundColor: colors.primary },
  sliderThumb: { position: 'absolute', top: -6, width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 4, borderColor: colors.primary, transform: [{ translateX: -8 }] },
  enableContent: { padding: 16, paddingBottom: 40, backgroundColor: colors.background, gap: 14 },
  phonePreview: { alignSelf: 'center', width: '64%', aspectRatio: 9 / 18.5, borderRadius: 26, overflow: 'hidden', backgroundColor: colors.black, borderWidth: 5, borderColor: '#221B2D' },
  previewVideo: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  previewClock: { position: 'absolute', left: 0, right: 0, top: 40, alignItems: 'center' },
  previewTime: { color: '#FFFFFF', fontSize: 28, fontWeight: '300', textShadowColor: '#000000AA', textShadowRadius: 4 },
  previewDate: { color: '#FFFFFF', fontSize: 9, marginTop: 1, textShadowColor: '#000000AA', textShadowRadius: 4 },
  applyButton: { minHeight: 56, backgroundColor: colors.primary, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  applyButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  systemNote: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', paddingHorizontal: 18 },
  bottomNavigation: { height: 68, flexDirection: 'row', backgroundColor: colors.panel, borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: 4 },
  navButton: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navGlyph: { color: '#988FA6', fontSize: 21, fontWeight: '800', lineHeight: 24 },
  navLabel: { color: '#988FA6', fontSize: 10, fontWeight: '700', marginTop: 2 },
  navActive: { color: colors.primary },
});
