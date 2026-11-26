using System.Collections.Concurrent;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using MindQuest.Engine;
using MindQuest.Models;

var cli = CliOptions.Parse(args);
if (cli.ErrorMessage is not null)
{
    Console.Error.WriteLine($"Error: {cli.ErrorMessage}");
    Console.Error.WriteLine("Run 'MindQuest --help' for usage information.");
    Environment.ExitCode = 1;
    return;
}

if (cli.ShowHelp)
{
    CliOptions.PrintHelp();
    return;
}

if (cli.ShowVersion)
{
    Console.WriteLine("MindQuest 0.0.0 (.NET 10 Self-Contained WebApp)");
    return;
}

var baseDir = AppContext.BaseDirectory;
var wwwrootPath = Directory.Exists(Path.Combine(baseDir, "wwwroot"))
    ? Path.Combine(baseDir, "wwwroot")
    : Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");

var envLogLevel = Environment.GetEnvironmentVariable("LOG_LEVEL");
var effectiveLogLevel = cli.MinimumLogLevel
    ?? (CliOptions.TryParseLogLevel(envLogLevel, out var parsedEnvLog) ? parsedEnvLog : LogLevel.Warning);

var portEnv = Environment.GetEnvironmentVariable("PORT");
var httpPortEnv = Environment.GetEnvironmentVariable("HTTP_PORT");
var httpsPortEnv = Environment.GetEnvironmentVariable("HTTPS_PORT");

var explicitHttp = cli.HttpPort.HasValue || !string.IsNullOrWhiteSpace(portEnv) || !string.IsNullOrWhiteSpace(httpPortEnv);
var explicitHttps = cli.HttpsPort.HasValue || !string.IsNullOrWhiteSpace(httpsPortEnv);

var requestedHttpPort = cli.HttpPort
    ?? (int.TryParse(portEnv, out var parsedPort)
        ? parsedPort
        : (int.TryParse(httpPortEnv, out var parsedHttp) ? parsedHttp : 80));

int? requestedHttpsPort = cli.DisableHttps
    ? null
    : (cli.HttpsPort
        ?? (int.TryParse(httpsPortEnv, out var parsedHttps)
            ? parsedHttps
            : (string.IsNullOrWhiteSpace(portEnv) && !cli.HttpPort.HasValue ? 443 : null)));

var certPathOverride = cli.CertPath ?? Environment.GetEnvironmentVariable("HTTPS_CERT_PATH");
var certPasswordOverride = cli.CertPassword ?? Environment.GetEnvironmentVariable("HTTPS_CERT_PASSWORD");

if (!string.IsNullOrWhiteSpace(cli.CertPath) && !File.Exists(cli.CertPath))
{
    Console.Error.WriteLine($"Error: Certificate file not found: {cli.CertPath}");
    Environment.ExitCode = 1;
    return;
}

X509Certificate2? sharedHttpsCert = null;
if (!cli.DisableHttps && (requestedHttpsPort.HasValue || !explicitHttp))
{
    try
    {
        sharedHttpsCert = LoadOrCreateHttpsCertificate(certPathOverride, certPasswordOverride);
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"Error: Unable to load TLS certificate: {ex.Message}");
        Environment.ExitCode = 1;
        return;
    }
}

var activeHttpPort = requestedHttpPort;
int? activeHttpsPort = requestedHttpsPort;

var syncLock = new object();
var rooms = new Dictionary<string, InternalRoom>(StringComparer.OrdinalIgnoreCase);
var roomTimers = new Dictionary<string, CancellationTokenSource>(StringComparer.OrdinalIgnoreCase);
var clients = new ConcurrentDictionary<string, ClientConnection>();

static long NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

List<PublicRoomSummary> GetJoinableRoomsLocked() =>
    rooms.Values
        .Where(r => r.Phase == "waiting" && r.Players.Any(p => p.Connected))
        .OrderByDescending(r => r.CreatedAt)
        .Select(QuizEngine.BuildRoomSummary)
        .ToList();

void SendJson(ClientConnection client, ServerMessage payload)
{
    if (client.Socket.State != WebSocketState.Open) return;
    var jsonBytes = JsonSerializer.SerializeToUtf8Bytes(payload, AppJsonContext.Default.ServerMessage);
    _ = client.SendAsync(jsonBytes);
}

void BroadcastRoomStateLocked(string code)
{
    if (!rooms.TryGetValue(code, out var room)) return;
    var snapshot = QuizEngine.BuildSnapshot(room, NowMs());
    var msg = new ServerMessage { Type = "room:state", Room = snapshot };
    foreach (var client in clients.Values)
    {
        if (string.Equals(client.RoomCode, code, StringComparison.OrdinalIgnoreCase))
        {
            SendJson(client, msg);
        }
    }
}

void BroadcastToRoom(string code, ServerMessage msg)
{
    foreach (var client in clients.Values)
    {
        if (string.Equals(client.RoomCode, code, StringComparison.OrdinalIgnoreCase))
        {
            SendJson(client, msg);
        }
    }
}

void BroadcastRoomsListLocked()
{
    var list = GetJoinableRoomsLocked();
    var msg = new ServerMessage { Type = "rooms:list", Rooms = list };
    foreach (var client in clients.Values)
    {
        if (client.SubscribedToLobbyList)
        {
            SendJson(client, msg);
        }
    }
}

void ClearRoomTimerLocked(string code)
{
    if (roomTimers.Remove(code, out var cts))
    {
        cts.Cancel();
        cts.Dispose();
    }
}

void CleanupRoomIfEmptyLocked(string code)
{
    if (!rooms.TryGetValue(code, out var room)) return;
    if (!room.Players.Any(p => p.Connected))
    {
        ClearRoomTimerLocked(code);
        rooms.Remove(code);
        BroadcastRoomsListLocked();
    }
}

void ScheduleTimer(string code, int delayMs, Action<InternalRoom> onElapsed)
{
    ClearRoomTimerLocked(code);
    var cts = new CancellationTokenSource();
    roomTimers[code] = cts;
    _ = Task.Run(async () =>
    {
        try
        {
            await Task.Delay(Math.Max(200, delayMs), cts.Token);
            lock (syncLock)
            {
                if (cts.IsCancellationRequested) return;
                if (rooms.TryGetValue(code, out var room))
                {
                    onElapsed(room);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    });
}

void ScheduleCountdownTransitionLocked(string code)
{
    ScheduleTimer(code, 3000, room =>
    {
        if (room.Phase != "countdown") return;
        if (QuizEngine.BeginQuestionRound(room, NowMs()))
        {
            BroadcastRoomStateLocked(code);
            ScheduleQuestionTimeoutLocked(code);
        }
    });
}

void ScheduleQuestionTimeoutLocked(string code)
{
    if (!rooms.TryGetValue(code, out var room) || room.Phase != "question" || !room.QuestionEndsAt.HasValue)
        return;
    var delayMs = (int)Math.Max(250, room.QuestionEndsAt.Value - NowMs());
    ScheduleTimer(code, delayMs, current =>
    {
        if (current.Phase != "question") return;
        if (QuizEngine.FinalizeQuestionRound(current, NowMs()))
        {
            BroadcastRoomStateLocked(code);
            ScheduleRevealAdvanceLocked(code);
        }
    });
}

void ScheduleRevealAdvanceLocked(string code)
{
    ScheduleTimer(code, 5500, current =>
    {
        if (current.Phase != "reveal") return;
        var outcome = QuizEngine.AdvanceToNextQuestionOrFinish(current, NowMs());
        BroadcastRoomStateLocked(code);
        if (outcome == "question")
        {
            ScheduleQuestionTimeoutLocked(code);
        }
        else
        {
            BroadcastRoomsListLocked();
        }
    });
}

// Endpoint routes are registered per built WebApplication instance inside BuildServer().

static string FormatOrigin(string scheme, string host, int listenPort)
{
    var isDefault = (scheme == "http" && listenPort == 80) || (scheme == "https" && listenPort == 443);
    return isDefault ? $"{scheme}://{host}" : $"{scheme}://{host}:{listenPort}";
}

static bool IsPrivateLanIpv4(IPAddress address)
{
    var bytes = address.GetAddressBytes();
    if (bytes.Length != 4) return false;
    return bytes[0] == 10
        || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
        || (bytes[0] == 192 && bytes[1] == 168);
}

static bool IsLinkLocalIpv4(IPAddress address)
{
    var bytes = address.GetAddressBytes();
    return bytes.Length == 4 && bytes[0] == 169 && bytes[1] == 254;
}

static int PrivateLanRank(IPAddress address)
{
    var bytes = address.GetAddressBytes();
    if (bytes.Length != 4) return 99;
    if (bytes[0] == 192 && bytes[1] == 168) return 0;
    if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return 1;
    if (bytes[0] == 10) return 2;
    return 10;
}

static List<IPAddress> GetLocalIpv4Addresses()
{
    var preferred = new List<IPAddress>();
    var other = new List<IPAddress>();
    var linkLocal = new List<IPAddress>();
    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
    {
        if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
            continue;
        foreach (var ip in nic.GetIPProperties().UnicastAddresses)
        {
            if (ip.Address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(ip.Address))
                continue;

            if (!seen.Add(ip.Address.ToString())) continue;

            if (IsPrivateLanIpv4(ip.Address))
                preferred.Add(ip.Address);
            else if (IsLinkLocalIpv4(ip.Address))
                linkLocal.Add(ip.Address);
            else
                other.Add(ip.Address);
        }
    }

    preferred.Sort((a, b) => PrivateLanRank(a).CompareTo(PrivateLanRank(b)));
    preferred.AddRange(other);
    return preferred.Count > 0 ? preferred : linkLocal;
}

static List<string> GetLanUrls(string scheme, int listenPort) =>
    GetLocalIpv4Addresses()
        .Select(ip => FormatOrigin(scheme, ip.ToString(), listenPort))
        .ToList();

static X509Certificate2 LoadOrCreateHttpsCertificate(string? certPath, string? password)
{
    if (string.IsNullOrWhiteSpace(certPath))
    {
        var defaultPfx = Path.Combine(AppContext.BaseDirectory, "cert.pfx");
        if (File.Exists(defaultPfx))
            certPath = defaultPfx;
    }

    if (!string.IsNullOrWhiteSpace(certPath) && File.Exists(certPath))
    {
        return X509CertificateLoader.LoadPkcs12FromFile(certPath, password);
    }

    using var rsa = RSA.Create(2048);
    var req = new CertificateRequest(
        "CN=MindQuest",
        rsa,
        HashAlgorithmName.SHA256,
        RSASignaturePadding.Pkcs1);

    var san = new SubjectAlternativeNameBuilder();
    san.AddDnsName("localhost");
    san.AddIpAddress(IPAddress.Loopback);
    san.AddIpAddress(IPAddress.IPv6Loopback);
    foreach (var ip in GetLocalIpv4Addresses())
    {
        san.AddIpAddress(ip);
    }
    req.CertificateExtensions.Add(san.Build());
    req.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
    req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, false));

    var now = DateTimeOffset.UtcNow;
    using var cert = req.CreateSelfSigned(now.AddDays(-1), now.AddYears(2));
    var pfxBytes = cert.Export(X509ContentType.Pfx);
    return X509CertificateLoader.LoadPkcs12(pfxBytes, null);
}

WebApplication BuildServer(int candidateHttpPort, int? candidateHttpsPort, X509Certificate2? cert)
{
    var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
    {
        Args = [],
        ContentRootPath = baseDir,
        WebRootPath = wwwrootPath
    });

    builder.Logging.ClearProviders();
    if (effectiveLogLevel != LogLevel.None)
    {
        builder.Logging.AddSimpleConsole(options =>
        {
            options.SingleLine = true;
            options.TimestampFormat = "HH:mm:ss ";
        });
    }
    builder.Logging.SetMinimumLevel(effectiveLogLevel);
    builder.Logging.AddFilter(null, effectiveLogLevel);
    if (effectiveLogLevel > LogLevel.Debug)
    {
        builder.Logging.AddFilter("Microsoft.Extensions.Hosting.Internal.Host", LogLevel.None);
    }

    builder.WebHost.ConfigureKestrel(options =>
    {
        if (cli.BindIp is null)
        {
            options.ListenAnyIP(candidateHttpPort);
            if (candidateHttpsPort.HasValue && cert is not null)
            {
                options.ListenAnyIP(candidateHttpsPort.Value, listenOptions =>
                {
                    listenOptions.UseHttps(cert);
                });
            }
        }
        else
        {
            options.Listen(cli.BindIp, candidateHttpPort);
            if (candidateHttpsPort.HasValue && cert is not null)
            {
                options.Listen(cli.BindIp, candidateHttpsPort.Value, listenOptions =>
                {
                    listenOptions.UseHttps(cert);
                });
            }
        }
    });

    builder.Services.ConfigureHttpJsonOptions(options =>
    {
        options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default);
    });

    var serverApp = builder.Build();
    serverApp.UseWebSockets(new WebSocketOptions
    {
        KeepAliveInterval = TimeSpan.FromSeconds(20)
    });
    serverApp.UseDefaultFiles();
    serverApp.UseStaticFiles();

    serverApp.MapGet("/api/health", () =>
    {
        int activeRooms;
        lock (syncLock) activeRooms = rooms.Count;
        return Results.Json(new HealthResponse
        {
            Ok = true,
            Runtime = "dotnet-10",
            ActiveRooms = activeRooms,
            QuestionCount = QuestionBank.All.Count
        }, AppJsonContext.Default.HealthResponse);
    });

    serverApp.MapGet("/api/rooms", () =>
    {
        List<PublicRoomSummary> list;
        lock (syncLock) list = GetJoinableRoomsLocked();
        return Results.Json(new RoomsListResponse { Rooms = list }, AppJsonContext.Default.RoomsListResponse);
    });

    serverApp.MapGet("/api/server-info", () =>
    {
        return Results.Json(new ServerInfoResponse
        {
            Port = activeHttpPort,
            HttpsPort = activeHttpsPort,
            LanUrls = GetLanUrls("http", activeHttpPort),
            HttpsLanUrls = activeHttpsPort.HasValue ? GetLanUrls("https", activeHttpsPort.Value) : []
        }, AppJsonContext.Default.ServerInfoResponse);
    });

    serverApp.Use(async (context, next) =>
    {
        if (!context.Request.Path.Equals("/ws", StringComparison.OrdinalIgnoreCase))
        {
            await next();
            return;
        }

        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        using var ws = await context.WebSockets.AcceptWebSocketAsync();
        var connId = Guid.NewGuid().ToString();
        var meta = new ClientConnection(connId, ws);
        clients[connId] = meta;

        lock (syncLock)
        {
            SendJson(meta, new ServerMessage { Type = "rooms:list", Rooms = GetJoinableRoomsLocked() });
        }

        var buffer = new byte[16 * 1024];
        using var ms = new MemoryStream();

        try
        {
            while (ws.State == WebSocketState.Open)
            {
                ms.SetLength(0);
                WebSocketReceiveResult result;
                do
                {
                    result = await ws.ReceiveAsync(buffer, CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closed", CancellationToken.None);
                        break;
                    }
                    if (result.Count > 0)
                    {
                        ms.Write(buffer, 0, result.Count);
                    }
                } while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text) continue;

                ClientMessage? msg;
                try
                {
                    msg = JsonSerializer.Deserialize(ms.ToArray(), AppJsonContext.Default.ClientMessage);
                }
                catch
                {
                    SendJson(meta, new ServerMessage { Type = "room:error", Message = "فرمت پیام نامعتبر است." });
                    continue;
                }

                if (msg is null) continue;

                lock (syncLock)
                {
                    switch (msg.Type)
                    {
                        case "rooms:subscribe":
                            meta.SubscribedToLobbyList = true;
                            SendJson(meta, new ServerMessage { Type = "rooms:list", Rooms = GetJoinableRoomsLocked() });
                            break;

                        case "room:create":
                        {
                            if (!string.IsNullOrEmpty(meta.RoomCode) && rooms.TryGetValue(meta.RoomCode, out var prev))
                            {
                                QuizEngine.DisconnectPlayer(prev, meta.PlayerId);
                                CleanupRoomIfEmptyLocked(meta.RoomCode);
                                BroadcastRoomStateLocked(meta.RoomCode);
                            }

                            var code = QuizEngine.GenerateRoomCode(rooms.Keys);
                            var room = QuizEngine.CreateRoom(code, meta.PlayerId, msg.PlayerName, msg.Avatar, msg.Color, msg.Settings, NowMs());
                            rooms[code] = room;
                            meta.RoomCode = code;
                            SendJson(meta, new ServerMessage
                            {
                                Type = "room:joined",
                                PlayerId = meta.PlayerId,
                                Room = QuizEngine.BuildSnapshot(room, NowMs())
                            });
                            BroadcastRoomsListLocked();
                            break;
                        }

                        case "room:join":
                        {
                            var cleanCode = (msg.Code ?? "").Trim().ToUpperInvariant();
                            if (!rooms.TryGetValue(cleanCode, out var room))
                            {
                                SendJson(meta, new ServerMessage { Type = "room:error", Message = $"اتاقی با کد «{cleanCode}» پیدا نشد." });
                                break;
                            }

                            if (!string.IsNullOrEmpty(meta.RoomCode) &&
                                !string.Equals(meta.RoomCode, cleanCode, StringComparison.OrdinalIgnoreCase) &&
                                rooms.TryGetValue(meta.RoomCode, out var prev))
                            {
                                QuizEngine.DisconnectPlayer(prev, meta.PlayerId);
                                CleanupRoomIfEmptyLocked(meta.RoomCode);
                                BroadcastRoomStateLocked(meta.RoomCode);
                            }

                            var targetPlayerId = string.IsNullOrEmpty(msg.PlayerId) ? meta.PlayerId : msg.PlayerId;
                            var (joinedPlayer, err) = QuizEngine.AddOrReconnectPlayer(room, targetPlayerId, msg.PlayerName, msg.Avatar, msg.Color);
                            if (err is not null || joinedPlayer is null)
                            {
                                SendJson(meta, new ServerMessage { Type = "room:error", Message = err ?? "خطا در ورود به اتاق" });
                                break;
                            }

                            meta.PlayerId = joinedPlayer.Id;
                            meta.RoomCode = cleanCode;
                            SendJson(meta, new ServerMessage
                            {
                                Type = "room:joined",
                                PlayerId = meta.PlayerId,
                                Room = QuizEngine.BuildSnapshot(room, NowMs())
                            });
                            BroadcastRoomStateLocked(cleanCode);
                            BroadcastRoomsListLocked();
                            break;
                        }

                        case "room:rejoin":
                        {
                            var cleanCode = (msg.Code ?? "").Trim().ToUpperInvariant();
                            if (!rooms.TryGetValue(cleanCode, out var room))
                            {
                                SendJson(meta, new ServerMessage { Type = "room:error", Message = "اتاق منقضی شده یا بسته شده است." });
                                break;
                            }
                            var existing = room.Players.FirstOrDefault(p => p.Id == msg.PlayerId);
                            if (existing is null)
                            {
                                SendJson(meta, new ServerMessage { Type = "room:error", Message = "نشست بازیکن در این اتاق یافت نشد." });
                                break;
                            }
                            existing.Connected = true;
                            meta.PlayerId = existing.Id;
                            meta.RoomCode = cleanCode;
                            SendJson(meta, new ServerMessage
                            {
                                Type = "room:joined",
                                PlayerId = meta.PlayerId,
                                Room = QuizEngine.BuildSnapshot(room, NowMs())
                            });
                            BroadcastRoomStateLocked(cleanCode);
                            break;
                        }

                        case "room:leave":
                        {
                            if (!string.IsNullOrEmpty(meta.RoomCode))
                            {
                                var code = meta.RoomCode;
                                meta.RoomCode = null;
                                if (rooms.TryGetValue(code, out var room))
                                {
                                    QuizEngine.DisconnectPlayer(room, meta.PlayerId);
                                    CleanupRoomIfEmptyLocked(code);
                                    BroadcastRoomStateLocked(code);
                                    BroadcastRoomsListLocked();
                                }
                            }
                            break;
                        }

                        default:
                        {
                            if (string.IsNullOrEmpty(meta.RoomCode) || !rooms.TryGetValue(meta.RoomCode, out var room))
                                break;

                            switch (msg.Type)
                            {
                                case "room:ready":
                                {
                                    var player = room.Players.FirstOrDefault(p => p.Id == meta.PlayerId);
                                    if (player is not null && room.Phase == "waiting")
                                    {
                                        player.IsReady = msg.IsReady ?? true;
                                        BroadcastRoomStateLocked(room.Code);
                                    }
                                    break;
                                }
                                case "room:settings":
                                    if (QuizEngine.UpdateSettings(room, meta.PlayerId, msg.Settings))
                                    {
                                        BroadcastRoomStateLocked(room.Code);
                                        BroadcastRoomsListLocked();
                                    }
                                    break;
                                case "room:start":
                                {
                                    var (ok, err) = QuizEngine.StartMatch(room, meta.PlayerId, QuestionBank.All, NowMs());
                                    if (!ok)
                                    {
                                        SendJson(meta, new ServerMessage { Type = "room:error", Message = err ?? "خطا در شروع مسابقه" });
                                        break;
                                    }
                                    BroadcastRoomStateLocked(room.Code);
                                    BroadcastRoomsListLocked();
                                    ScheduleCountdownTransitionLocked(room.Code);
                                    break;
                                }
                                case "answer:submit":
                                {
                                    var (accepted, allAnswered) = QuizEngine.SubmitAnswer(room, meta.PlayerId, msg.OptionIndex ?? -1, NowMs());
                                    if (!accepted) break;
                                    if (allAnswered)
                                    {
                                        ClearRoomTimerLocked(room.Code);
                                        QuizEngine.FinalizeQuestionRound(room, NowMs());
                                        BroadcastRoomStateLocked(room.Code);
                                        ScheduleRevealAdvanceLocked(room.Code);
                                    }
                                    else
                                    {
                                        BroadcastRoomStateLocked(room.Code);
                                    }
                                    break;
                                }
                                case "room:next":
                                {
                                    var isHost = room.Players.Any(p => p.Id == meta.PlayerId && p.IsHost);
                                    if (!isHost || room.Phase != "reveal") break;
                                    ClearRoomTimerLocked(room.Code);
                                    var outcome = QuizEngine.AdvanceToNextQuestionOrFinish(room, NowMs());
                                    BroadcastRoomStateLocked(room.Code);
                                    if (outcome == "question") ScheduleQuestionTimeoutLocked(room.Code);
                                    else BroadcastRoomsListLocked();
                                    break;
                                }
                                case "room:rematch":
                                    if (QuizEngine.ResetRoomToLobby(room, meta.PlayerId))
                                    {
                                        ClearRoomTimerLocked(room.Code);
                                        BroadcastRoomStateLocked(room.Code);
                                        BroadcastRoomsListLocked();
                                    }
                                    break;
                                case "room:cheer":
                                {
                                    var player = room.Players.FirstOrDefault(p => p.Id == meta.PlayerId);
                                    if (player is not null && !string.IsNullOrEmpty(msg.Emoji))
                                    {
                                        var emoji = msg.Emoji.Length > 4 ? msg.Emoji[..4] : msg.Emoji;
                                        BroadcastToRoom(room.Code, new ServerMessage
                                        {
                                            Type = "room:cheer",
                                            PlayerId = player.Id,
                                            PlayerName = player.Name,
                                            Emoji = emoji
                                        });
                                    }
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }
        catch (WebSocketException)
        {
        }
        finally
        {
            clients.TryRemove(connId, out _);
            lock (syncLock)
            {
                if (!string.IsNullOrEmpty(meta.RoomCode) && rooms.TryGetValue(meta.RoomCode, out var room))
                {
                    QuizEngine.DisconnectPlayer(room, meta.PlayerId);
                    CleanupRoomIfEmptyLocked(meta.RoomCode);
                    BroadcastRoomStateLocked(meta.RoomCode);
                    BroadcastRoomsListLocked();
                }
            }
        }
    });

    serverApp.MapFallback(async context =>
    {
        var indexPath = Path.Combine(serverApp.Environment.WebRootPath ?? Path.Combine(AppContext.BaseDirectory, "wwwroot"), "index.html");
        if (File.Exists(indexPath))
        {
            context.Response.ContentType = "text/html; charset=utf-8";
            await context.Response.SendFileAsync(indexPath);
        }
        else
        {
            context.Response.StatusCode = 404;
        }
    });

    return serverApp;
}

var attempts = new List<(int Http, int? Https)> { (requestedHttpPort, requestedHttpsPort) };
if (!cli.DisableHttps && !explicitHttps && requestedHttpsPort.HasValue)
{
    attempts.Add((requestedHttpPort, null));
}

if (!explicitHttp)
{
    int? fallbackHttpsFor(int candidateHttps) =>
        cli.DisableHttps ? null : (explicitHttps ? requestedHttpsPort : candidateHttps);

    var fallbackHttpPorts = new (int Http, int? Https)[]
    {
        (8080, fallbackHttpsFor(8443)),
        (8080, cli.DisableHttps || explicitHttps ? requestedHttpsPort : null),
        (5000, fallbackHttpsFor(5443)),
        (5000, cli.DisableHttps || explicitHttps ? requestedHttpsPort : null),
        (8888, cli.DisableHttps || explicitHttps ? requestedHttpsPort : null),
        (9000, cli.DisableHttps || explicitHttps ? requestedHttpsPort : null),
        (3000, cli.DisableHttps || explicitHttps ? requestedHttpsPort : null)
    };

    foreach (var fb in fallbackHttpPorts)
    {
        if (fb.Http == requestedHttpPort && fb.Https == requestedHttpsPort) continue;
        if (!attempts.Contains(fb)) attempts.Add(fb);
    }
}

WebApplication? runningApp = null;
SocketException? lastSocketError = null;
(int Http, int? Https) lastFailedAttempt = (requestedHttpPort, requestedHttpsPort);
SocketException? requestedPortSocketError = null;
(int Http, int? Https) requestedPortFailedAttempt = (requestedHttpPort, requestedHttpsPort);
var sawPrivilegedAccessDenied = false;

foreach (var attempt in attempts)
{
    if (sawPrivilegedAccessDenied && attempt.Http < 1024)
    {
        continue;
    }

    var candidateApp = BuildServer(attempt.Http, attempt.Https, sharedHttpsCert);
    try
    {
        activeHttpPort = attempt.Http;
        activeHttpsPort = attempt.Https;
        await candidateApp.StartAsync();
        runningApp = candidateApp;
        break;
    }
    catch (Exception ex) when (FindSocketException(ex) is { } sockEx)
    {
        lastSocketError = sockEx;
        lastFailedAttempt = attempt;
        if (attempt.Http == requestedHttpPort)
        {
            requestedPortSocketError = sockEx;
            requestedPortFailedAttempt = attempt;
        }
        if (sockEx.SocketErrorCode == SocketError.AccessDenied &&
            (attempt.Http < 1024 || (attempt.Https.HasValue && attempt.Https.Value < 1024)))
        {
            sawPrivilegedAccessDenied = true;
        }
        await candidateApp.DisposeAsync();
    }
    catch
    {
        await candidateApp.DisposeAsync();
        throw;
    }
}

if (runningApp is null)
{
    var exeName = Path.GetFileName(Environment.ProcessPath ?? "MindQuest");
    if (lastSocketError?.SocketErrorCode == SocketError.AccessDenied || sawPrivilegedAccessDenied)
    {
        Console.Error.WriteLine($"Error: Permission denied binding privileged port {lastFailedAttempt.Http}" + (lastFailedAttempt.Https.HasValue ? $"/{lastFailedAttempt.Https.Value}" : "") + ".");
        Console.Error.WriteLine("On Linux, ports below 1024 require elevated privileges. Run one of:");
        Console.Error.WriteLine($"  sudo setcap 'cap_net_bind_service=+ep' \"$(pwd)/{exeName}\" && ./{exeName}");
        Console.Error.WriteLine($"  sudo ./{exeName}");
        Console.Error.WriteLine($"  ./{exeName} -p 8080 --no-https");
    }
    else if (lastSocketError?.SocketErrorCode == SocketError.AddressAlreadyInUse)
    {
        Console.Error.WriteLine($"Error: Port {lastFailedAttempt.Http}" + (lastFailedAttempt.Https.HasValue ? $" or {lastFailedAttempt.Https.Value}" : "") + " is already in use. Choose another port with '-p 8080'.");
    }
    else if (lastSocketError is not null)
    {
        Console.Error.WriteLine($"Error starting server ({lastSocketError.SocketErrorCode}): {lastSocketError.Message}");
    }
    else
    {
        Console.Error.WriteLine("Error: Unable to bind any HTTP port.");
    }
    Environment.ExitCode = 1;
    return;
}

if (!cli.Quiet)
{
    var exeName = Path.GetFileName(Environment.ProcessPath ?? "MindQuest");
    if (sawPrivilegedAccessDenied)
    {
        Console.WriteLine(
            $"Note: Permission denied on privileged port {requestedHttpPort} (non-root Linux). Switched automatically to HTTP :{activeHttpPort}" +
            (activeHttpsPort.HasValue ? $" and HTTPS :{activeHttpsPort.Value}" : "") +
            ".\n      To run on default ports 80/443 without sudo, grant network capability once:\n" +
            $"        sudo setcap 'cap_net_bind_service=+ep' \"$(pwd)/{exeName}\" && ./{exeName}\n" +
            $"      Or run: sudo ./{exeName}");
    }
    else if (activeHttpPort != requestedHttpPort)
    {
        var failedPorts = requestedPortFailedAttempt.Https.HasValue
            ? $"{requestedPortFailedAttempt.Http}/{requestedPortFailedAttempt.Https.Value}"
            : requestedPortFailedAttempt.Http.ToString();
        var destination = $"HTTP :{activeHttpPort}" +
            (activeHttpsPort.HasValue ? $" and HTTPS :{activeHttpsPort.Value}" : "");

        if (requestedPortSocketError?.SocketErrorCode == SocketError.AddressAlreadyInUse)
        {
            Console.WriteLine(
                $"Note: Requested port(s) {failedPorts} are already in use. sudo cannot take a port owned by another process; inspect listeners with `sudo ss -ltnp '( sport = :80 or sport = :443 )'`. " +
                $"Switched automatically to {destination}.");
        }
        else if (requestedPortSocketError is not null)
        {
            Console.WriteLine(
                $"Note: Could not bind requested port(s) {failedPorts} ({requestedPortSocketError.SocketErrorCode}: {requestedPortSocketError.Message}). " +
                $"Switched automatically to {destination}.");
        }
        else
        {
            Console.WriteLine($"Note: Default port {requestedHttpPort} was unavailable. Switched automatically to {destination}.");
        }
    }

    var bindLabel = cli.BindIp?.ToString() ?? "0.0.0.0";
    Console.WriteLine($"MindQuest .NET 10 Self-Contained WebApp listening on HTTP {bindLabel}:{activeHttpPort}" + (activeHttpsPort.HasValue ? $" and HTTPS {bindLabel}:{activeHttpsPort.Value}" : ""));
    Console.WriteLine($"Log level:   {effectiveLogLevel}");
    Console.WriteLine($"Local HTTP:  {FormatOrigin("http", "localhost", activeHttpPort)}");
    if (activeHttpsPort.HasValue)
    {
        Console.WriteLine($"Local HTTPS: {FormatOrigin("https", "localhost", activeHttpsPort.Value)}");
    }
    if (!IPAddress.IsLoopback(cli.BindIp ?? IPAddress.Any))
    {
        foreach (var lanUrl in GetLanUrls("http", activeHttpPort))
        {
            Console.WriteLine($"Phone/LAN:   {lanUrl}");
        }
        if (activeHttpsPort.HasValue)
        {
            foreach (var httpsLanUrl in GetLanUrls("https", activeHttpsPort.Value))
            {
                Console.WriteLine($"HTTPS/LAN:   {httpsLanUrl}");
            }
        }
    }
}

try
{
    await runningApp.WaitForShutdownAsync();
}
finally
{
    await runningApp.DisposeAsync();
}

static SocketException? FindSocketException(Exception? ex)
{
    while (ex is not null)
    {
        if (ex is SocketException se) return se;
        ex = ex.InnerException;
    }
    return null;
}

internal sealed class CliOptions
{
    public bool ShowHelp { get; private set; }
    public bool ShowVersion { get; private set; }
    public bool Quiet { get; private set; }
    public bool DisableHttps { get; private set; }
    public int? HttpPort { get; private set; }
    public int? HttpsPort { get; private set; }
    public LogLevel? MinimumLogLevel { get; private set; }
    public IPAddress? BindIp { get; private set; }
    public string? CertPath { get; private set; }
    public string? CertPassword { get; private set; }
    public string? ErrorMessage { get; private set; }

    public static bool TryParseLogLevel(string? raw, out LogLevel level)
    {
        switch ((raw ?? "").Trim().ToLowerInvariant())
        {
            case "trace":
            case "trce":
                level = LogLevel.Trace;
                return true;
            case "debug":
            case "dbug":
                level = LogLevel.Debug;
                return true;
            case "info":
            case "information":
                level = LogLevel.Information;
                return true;
            case "warn":
            case "warning":
                level = LogLevel.Warning;
                return true;
            case "err":
            case "error":
                level = LogLevel.Error;
                return true;
            case "crit":
            case "critical":
                level = LogLevel.Critical;
                return true;
            case "none":
            case "off":
                level = LogLevel.None;
                return true;
            default:
                level = LogLevel.Information;
                return false;
        }
    }

    public static CliOptions Parse(string[] args)
    {
        var opts = new CliOptions();
        for (int i = 0; i < args.Length; i++)
        {
            var raw = args[i];
            string key = raw;
            string? inlineValue = null;
            var eqIdx = raw.IndexOf('=');
            if (eqIdx > 0 && raw.StartsWith('-'))
            {
                key = raw[..eqIdx];
                inlineValue = raw[(eqIdx + 1)..];
            }

            string? ReadValue(string optionName)
            {
                if (inlineValue is not null) return inlineValue;
                if (i + 1 < args.Length) return args[++i];
                opts.ErrorMessage = $"Missing value for '{optionName}'.";
                return null;
            }

            switch (key)
            {
                case "-h":
                case "--help":
                case "-?":
                    opts.ShowHelp = true;
                    return opts;

                case "-v":
                case "--version":
                    opts.ShowVersion = true;
                    return opts;

                case "-q":
                case "--quiet":
                    opts.Quiet = true;
                    break;

                case "--no-https":
                    opts.DisableHttps = true;
                    break;

                case "-p":
                case "--port":
                case "--http-port":
                {
                    var val = ReadValue(key);
                    if (val is null) return opts;
                    if (!int.TryParse(val, out var port) || port < 1 || port > 65535)
                    {
                        opts.ErrorMessage = $"Invalid HTTP port '{val}'. Expected 1-65535.";
                        return opts;
                    }
                    opts.HttpPort = port;
                    break;
                }

                case "-s":
                case "--https-port":
                {
                    var val = ReadValue(key);
                    if (val is null) return opts;
                    if (!int.TryParse(val, out var port) || port < 1 || port > 65535)
                    {
                        opts.ErrorMessage = $"Invalid HTTPS port '{val}'. Expected 1-65535.";
                        return opts;
                    }
                    opts.HttpsPort = port;
                    break;
                }

                case "-l":
                case "--log-level":
                {
                    var val = ReadValue(key);
                    if (val is null) return opts;
                    if (!TryParseLogLevel(val, out var parsedLevel))
                    {
                        opts.ErrorMessage = $"Invalid log level '{val}'. Valid levels: trace, debug, info, warn, error, critical, none.";
                        return opts;
                    }
                    opts.MinimumLogLevel = parsedLevel;
                    break;
                }

                case "-b":
                case "--bind":
                case "--host":
                {
                    var val = ReadValue(key);
                    if (val is null) return opts;
                    if (string.Equals(val, "localhost", StringComparison.OrdinalIgnoreCase))
                    {
                        opts.BindIp = IPAddress.Loopback;
                    }
                    else if (val is "0.0.0.0" or "*" or "::")
                    {
                        opts.BindIp = null;
                    }
                    else if (IPAddress.TryParse(val, out var ip))
                    {
                        opts.BindIp = ip;
                    }
                    else
                    {
                        opts.ErrorMessage = $"Invalid bind address '{val}'. Use an IPv4/IPv6 address, '0.0.0.0', or 'localhost'.";
                        return opts;
                    }
                    break;
                }

                case "-c":
                case "--cert":
                {
                    var val = ReadValue(key);
                    if (val is null) return opts;
                    opts.CertPath = val;
                    break;
                }

                case "--cert-password":
                {
                    var val = ReadValue(key);
                    if (val is null) return opts;
                    opts.CertPassword = val;
                    break;
                }

                default:
                    opts.ErrorMessage = $"Unknown option '{raw}'.";
                    return opts;
            }
        }
        return opts;
    }

    public static void PrintHelp()
    {
        Console.WriteLine("""
MindQuest - Educational Solo & LAN Multiplayer Quiz Server (.NET 10)

Usage:
  MindQuest [options]

Options:
  -h, --help                 Show this help message and exit
  -v, --version              Show version information and exit
  -p, --port, --http-port N  HTTP port to listen on (default: 80, env: PORT / HTTP_PORT)
  -s, --https-port N         HTTPS port to listen on (default: 443, env: HTTPS_PORT)
      --no-https             Disable HTTPS listener (serve HTTP only)
  -b, --bind ADDR            Bind address: 0.0.0.0 (all, default), localhost, or IP
  -l, --log-level LEVEL      Log verbosity: trace, debug, info, warn, error, critical, none (default: warn)
  -c, --cert PATH            Path to PKCS#12 (.pfx) TLS certificate (env: HTTPS_CERT_PATH)
      --cert-password PASS   Password for the .pfx certificate (env: HTTPS_CERT_PASSWORD)
  -q, --quiet                Suppress startup banner and lower default log level to warn

Examples:
  MindQuest                                  Listen on HTTP :80 and HTTPS :443 on all interfaces
  MindQuest -l warn                          Listen on defaults with warning/error logs only
  MindQuest -p 8080 --no-https -l debug      Run HTTP-only on port 8080 with debug logging
  MindQuest -c ./cert.pfx --cert-password s  Use custom TLS certificate on HTTPS :443
""");
    }
}

internal sealed class ClientConnection(string initialId, WebSocket socket)
{
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    public string PlayerId { get; set; } = initialId;
    public WebSocket Socket { get; } = socket;
    public string? RoomCode { get; set; }
    public bool SubscribedToLobbyList { get; set; } = true;

    public async Task SendAsync(byte[] payload)
    {
        await _sendLock.WaitAsync();
        try
        {
            if (Socket.State == WebSocketState.Open)
            {
                await Socket.SendAsync(payload, WebSocketMessageType.Text, true, CancellationToken.None);
            }
        }
        catch
        {
        }
        finally
        {
            _sendLock.Release();
        }
    }
}
