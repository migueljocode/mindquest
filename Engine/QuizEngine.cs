using System.Reflection;
using System.Text.Json;
using MindQuest.Models;

namespace MindQuest.Engine;

public sealed class InternalRoom
{
    public string Code { get; init; } = "";
    public string Phase { get; set; } = "waiting";
    public RoomSettings Settings { get; } = new();
    public List<PlayerInfo> Players { get; } = [];
    public List<QuizQuestion> Questions { get; } = [];
    public int CurrentQuestionIndex { get; set; }
    public long? QuestionEndsAt { get; set; }
    public int TotalQuestionTime { get; set; } = 20;
    public long? PhaseEndsAt { get; set; }
    public RoomRevealPayload? Reveal { get; set; }
    public long CreatedAt { get; init; }
}

public static class QuestionBank
{
    public static readonly IReadOnlyList<QuizQuestion> All = LoadEmbeddedQuestions();

    private static IReadOnlyList<QuizQuestion> LoadEmbeddedQuestions()
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var stream = assembly.GetManifestResourceStream("MindQuest.Data.questions.json")
            ?? throw new InvalidOperationException("Embedded resource MindQuest.Data.questions.json not found.");
        var items = JsonSerializer.Deserialize(stream, AppJsonContext.Default.ListQuizQuestion);
        return items ?? [];
    }
}

public static class QuizEngine
{
    private const string CodeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public static int GetBasePoints(string difficulty) => difficulty switch
    {
        "hard" => 300,
        "medium" => 200,
        _ => 100
    };

    public static int GetTimePerQuestion(string difficulty) => difficulty switch
    {
        "hard" => 15,
        "medium" => 20,
        _ => 25
    };

    public static double GetStreakMultiplier(int streak)
    {
        if (streak >= 5) return 1.5;
        if (streak >= 3) return 1.25;
        return 1.0;
    }

    public static int CalculateEarnedScore(
        bool isCorrect,
        string difficulty,
        double timeLeftSec,
        int totalTimeSec,
        int currentStreak)
    {
        if (!isCorrect) return 0;
        var basePoints = GetBasePoints(difficulty);
        var safeTotal = totalTimeSec > 0 ? totalTimeSec : 20.0;
        var ratio = Math.Clamp(timeLeftSec / safeTotal, 0.0, 1.0);
        var timeBonus = Math.Round(ratio * (basePoints * 0.4));
        var multiplier = GetStreakMultiplier(currentStreak);
        return (int)Math.Round((basePoints + timeBonus) * multiplier);
    }

    public static List<QuizQuestion> SelectQuestions(
        IReadOnlyList<QuizQuestion> bank,
        string difficulty,
        int limit,
        string category)
    {
        var pool = bank.Where(q =>
            (string.IsNullOrEmpty(difficulty) || difficulty == "all" || q.Difficulty == difficulty) &&
            (string.IsNullOrEmpty(category) || category == "all" || q.BgTheme == category)
        ).ToList();

        if (pool.Count == 0)
        {
            pool = [.. bank];
        }

        for (var i = pool.Count - 1; i > 0; i--)
        {
            var j = Random.Shared.Next(i + 1);
            (pool[i], pool[j]) = (pool[j], pool[i]);
        }

        return pool.Take(Math.Min(limit, pool.Count)).ToList();
    }

    public static string GenerateRoomCode(ICollection<string> existing)
    {
        Span<char> chars = stackalloc char[4];
        for (var attempt = 0; attempt < 50; attempt++)
        {
            for (var i = 0; i < 4; i++)
            {
                chars[i] = CodeChars[Random.Shared.Next(CodeChars.Length)];
            }
            var code = new string(chars);
            if (!existing.Contains(code)) return code;
        }
        return Random.Shared.Next(1000, 9999).ToString();
    }

    public static InternalRoom CreateRoom(
        string code,
        string hostId,
        string? hostName,
        string? avatar,
        string? color,
        RoomSettings? settings,
        long nowMs)
    {
        var cleanName = (hostName ?? "").Trim();
        if (cleanName.Length > 20) cleanName = cleanName[..20];
        if (string.IsNullOrEmpty(cleanName)) cleanName = "میزبان";

        var room = new InternalRoom
        {
            Code = code,
            Phase = "waiting",
            CreatedAt = nowMs
        };

        if (settings is not null)
        {
            room.Settings.Difficulty = string.IsNullOrEmpty(settings.Difficulty) ? "all" : settings.Difficulty;
            room.Settings.QuestionCount = settings.QuestionCount > 0 ? Math.Clamp(settings.QuestionCount, 3, 30) : 10;
            room.Settings.Category = string.IsNullOrEmpty(settings.Category) ? "all" : settings.Category;
            room.Settings.GameMode = settings.GameMode == "classic" ? "classic" : "elimination";
        }

        room.Players.Add(new PlayerInfo
        {
            Id = hostId,
            Name = cleanName,
            Avatar = string.IsNullOrEmpty(avatar) ? "🧠" : avatar,
            Color = string.IsNullOrEmpty(color) ? "#4f46e5" : color,
            IsHost = true,
            IsReady = true,
            Connected = true,
            Rank = 1,
            PreviousRank = 1
        });

        return room;
    }

    public static (PlayerInfo? Player, string? Error) AddOrReconnectPlayer(
        InternalRoom room,
        string playerId,
        string? playerName,
        string? avatar,
        string? color)
    {
        var existing = room.Players.FirstOrDefault(p => p.Id == playerId);
        if (existing is not null)
        {
            existing.Connected = true;
            return (existing, null);
        }

        if (room.Players.Count >= 16)
        {
            return (null, "ظرفیت این اتاق تکمیل است (حداکثر ۱۶ بازیکن).");
        }

        if (room.Phase != "waiting")
        {
            return (null, "مسابقه در حال برگزاری است و امکان ورود جدید وجود ندارد.");
        }

        var cleanName = (playerName ?? "").Trim();
        if (cleanName.Length > 20) cleanName = cleanName[..20];
        if (string.IsNullOrEmpty(cleanName)) cleanName = $"بازیکن {room.Players.Count + 1}";

        var player = new PlayerInfo
        {
            Id = playerId,
            Name = cleanName,
            Avatar = string.IsNullOrEmpty(avatar) ? "🚀" : avatar,
            Color = string.IsNullOrEmpty(color) ? "#06b6d4" : color,
            IsHost = false,
            IsReady = true,
            Connected = true,
            Rank = room.Players.Count + 1,
            PreviousRank = room.Players.Count + 1
        };

        room.Players.Add(player);
        return (player, null);
    }

    public static bool DisconnectPlayer(InternalRoom room, string playerId)
    {
        var player = room.Players.FirstOrDefault(p => p.Id == playerId);
        if (player is null) return false;

        if (room.Phase == "waiting")
        {
            room.Players.Remove(player);
            if (player.IsHost && room.Players.Count > 0)
            {
                room.Players[0].IsHost = true;
                room.Players[0].IsReady = true;
            }
        }
        else
        {
            player.Connected = false;
            if (player.IsHost)
            {
                var nextConnected = room.Players.FirstOrDefault(p => p.Connected);
                if (nextConnected is not null)
                {
                    player.IsHost = false;
                    nextConnected.IsHost = true;
                }
            }
        }
        return true;
    }

    public static bool UpdateSettings(InternalRoom room, string playerId, RoomSettings? settings)
    {
        if (settings is null || room.Phase != "waiting") return false;
        var host = room.Players.FirstOrDefault(p => p.Id == playerId && p.IsHost);
        if (host is null) return false;

        if (!string.IsNullOrEmpty(settings.Difficulty)) room.Settings.Difficulty = settings.Difficulty;
        if (settings.QuestionCount > 0) room.Settings.QuestionCount = Math.Clamp(settings.QuestionCount, 3, 30);
        if (!string.IsNullOrEmpty(settings.Category)) room.Settings.Category = settings.Category;
        if (settings.GameMode is "classic" or "elimination") room.Settings.GameMode = settings.GameMode;
        return true;
    }

    public static (bool Ok, string? Error) StartMatch(
        InternalRoom room,
        string playerId,
        IReadOnlyList<QuizQuestion> bank,
        long nowMs)
    {
        var host = room.Players.FirstOrDefault(p => p.Id == playerId && p.IsHost);
        if (host is null) return (false, "فقط میزبان اتاق می‌تواند مسابقه را آغاز کند.");
        if (room.Phase != "waiting") return (false, "مسابقه قبلاً آغاز شده است.");

        var selected = SelectQuestions(bank, room.Settings.Difficulty, room.Settings.QuestionCount, room.Settings.Category);
        if (selected.Count == 0) return (false, "سؤالی برای این تنظیمات یافت نشد.");

        room.Questions.Clear();
        room.Questions.AddRange(selected);
        room.CurrentQuestionIndex = 0;
        room.Reveal = null;

        for (var i = 0; i < room.Players.Count; i++)
        {
            var p = room.Players[i];
            p.Score = 0;
            p.Streak = 0;
            p.MaxStreak = 0;
            p.CorrectCount = 0;
            p.WrongCount = 0;
            p.TimeoutCount = 0;
            p.HasAnsweredCurrent = false;
            p.LastEarnedScore = 0;
            p.LastAnswerIndex = null;
            p.LastAnswerCorrect = null;
            p.LastAnswerElapsedMs = null;
            p.IsEliminated = false;
            p.EliminatedRound = null;
            p.Rank = i + 1;
            p.PreviousRank = i + 1;
        }

        room.Phase = "countdown";
        room.PhaseEndsAt = nowMs + 3000;
        room.QuestionEndsAt = null;
        return (true, null);
    }

    public static bool BeginQuestionRound(InternalRoom room, long nowMs)
    {
        if (room.CurrentQuestionIndex < 0 || room.CurrentQuestionIndex >= room.Questions.Count)
        {
            room.Phase = "finished";
            room.PhaseEndsAt = null;
            room.QuestionEndsAt = null;
            return false;
        }

        var currentQ = room.Questions[room.CurrentQuestionIndex];
        var totalTime = GetTimePerQuestion(currentQ.Difficulty);
        room.Phase = "question";
        room.TotalQuestionTime = totalTime;
        room.QuestionEndsAt = nowMs + totalTime * 1000L;
        room.PhaseEndsAt = room.QuestionEndsAt;
        room.Reveal = null;

        foreach (var p in room.Players)
        {
            p.HasAnsweredCurrent = false;
            p.LastEarnedScore = 0;
            p.LastAnswerIndex = null;
            p.LastAnswerCorrect = null;
            p.LastAnswerElapsedMs = null;
        }

        return true;
    }

    public static (bool Accepted, bool AllAnswered) SubmitAnswer(
        InternalRoom room,
        string playerId,
        int optionIndex,
        long nowMs)
    {
        if (room.Phase != "question") return (false, false);

        var player = room.Players.FirstOrDefault(p => p.Id == playerId);
        if (player is null || player.IsEliminated || player.HasAnsweredCurrent) return (false, false);

        if (room.CurrentQuestionIndex < 0 || room.CurrentQuestionIndex >= room.Questions.Count)
            return (false, false);
        if (optionIndex < 0 || optionIndex > 3) return (false, false);

        var currentQ = room.Questions[room.CurrentQuestionIndex];
        var totalMs = room.TotalQuestionTime * 1000L;
        var remainingMs = Math.Max(0L, (room.QuestionEndsAt ?? nowMs) - nowMs);
        var elapsedMs = Math.Max(0L, totalMs - remainingMs);
        var timeLeftSec = remainingMs / 1000.0;
        var isCorrect = optionIndex == currentQ.CorrectIndex;

        player.HasAnsweredCurrent = true;
        player.LastAnswerIndex = optionIndex;
        player.LastAnswerCorrect = isCorrect;
        player.LastAnswerElapsedMs = elapsedMs;

        if (isCorrect)
        {
            player.CorrectCount++;
            player.Streak++;
            if (player.Streak > player.MaxStreak) player.MaxStreak = player.Streak;

            var earned = CalculateEarnedScore(true, currentQ.Difficulty, timeLeftSec, room.TotalQuestionTime, player.Streak);
            player.Score += earned;
            player.LastEarnedScore = earned;
        }
        else
        {
            player.WrongCount++;
            player.Streak = 0;
            player.LastEarnedScore = 0;
        }

        var activeConnected = room.Players.Where(p => p.Connected && !p.IsEliminated).ToList();
        var allAnswered = activeConnected.Count > 0 && activeConnected.All(p => p.HasAnsweredCurrent);
        return (true, allAnswered);
    }

    private static int ComparePlayersForStandings(PlayerInfo a, PlayerInfo b)
    {
        if (a.IsEliminated != b.IsEliminated) return a.IsEliminated ? 1 : -1;
        if (a.IsEliminated && b.IsEliminated)
        {
            var rA = a.EliminatedRound ?? 0;
            var rB = b.EliminatedRound ?? 0;
            if (rB != rA) return rB.CompareTo(rA);
        }
        var scoreCmp = b.Score.CompareTo(a.Score);
        if (scoreCmp != 0) return scoreCmp;
        var corrCountCmp = b.CorrectCount.CompareTo(a.CorrectCount);
        if (corrCountCmp != 0) return corrCountCmp;
        var currA = a.LastAnswerCorrect == true ? 1 : 0;
        var currB = b.LastAnswerCorrect == true ? 1 : 0;
        if (currB != currA) return currB.CompareTo(currA);
        var elA = a.LastAnswerElapsedMs ?? long.MaxValue;
        var elB = b.LastAnswerElapsedMs ?? long.MaxValue;
        return elA.CompareTo(elB);
    }

    public static bool FinalizeQuestionRound(InternalRoom room, long nowMs)
    {
        if (room.Phase != "question") return false;
        if (room.CurrentQuestionIndex < 0 || room.CurrentQuestionIndex >= room.Questions.Count) return false;
        var currentQ = room.Questions[room.CurrentQuestionIndex];

        foreach (var p in room.Players)
        {
            p.PreviousRank = p.Rank;
            if (!p.IsEliminated && !p.HasAnsweredCurrent)
            {
                p.TimeoutCount++;
                p.Streak = 0;
                p.LastEarnedScore = 0;
                p.LastAnswerIndex = null;
                p.LastAnswerCorrect = false;
                p.LastAnswerElapsedMs = room.TotalQuestionTime * 1000L + 1;
            }
        }

        var eliminatedThisRound = new List<EliminatedSummary>();
        if (room.Settings.GameMode == "elimination")
        {
            var activeRanked = room.Players.Where(p => !p.IsEliminated).ToList();
            activeRanked.Sort(ComparePlayersForStandings);
            if (activeRanked.Count > 1)
            {
                var target = activeRanked[^1];
                target.IsEliminated = true;
                target.EliminatedRound = room.CurrentQuestionIndex + 1;
                eliminatedThisRound.Add(new EliminatedSummary
                {
                    Id = target.Id,
                    Name = target.Name,
                    Avatar = target.Avatar,
                    Score = target.Score,
                    Round = target.EliminatedRound.Value
                });
            }
        }

        var standings = room.Players.ToList();
        standings.Sort(ComparePlayersForStandings);
        for (var i = 0; i < standings.Count; i++)
        {
            standings[i].Rank = i + 1;
        }

        var remainingActive = room.Players.Count(p => !p.IsEliminated);
        var willFinishByElim = room.Settings.GameMode == "elimination" && room.Players.Count > 1 && remainingActive <= 1;
        var willFinishByQuestions = room.CurrentQuestionIndex + 1 >= room.Questions.Count;

        room.Phase = "reveal";
        room.PhaseEndsAt = nowMs + 5500;
        room.QuestionEndsAt = null;
        room.Reveal = new RoomRevealPayload
        {
            CorrectIndex = currentQ.CorrectIndex,
            Explanation = currentQ.Explanation,
            Standings = standings.Select(p => p.Clone()).ToList(),
            EliminatedThisRound = eliminatedThisRound,
            MatchWillFinish = willFinishByElim || willFinishByQuestions
        };

        return true;
    }

    public static string AdvanceToNextQuestionOrFinish(InternalRoom room, long nowMs)
    {
        var remainingActive = room.Players.Count(p => !p.IsEliminated);
        if (room.Settings.GameMode == "elimination" && room.Players.Count > 1 && remainingActive <= 1)
        {
            room.Phase = "finished";
            room.PhaseEndsAt = null;
            room.QuestionEndsAt = null;
            return "finished";
        }

        room.CurrentQuestionIndex++;
        if (room.CurrentQuestionIndex >= room.Questions.Count)
        {
            room.Phase = "finished";
            room.PhaseEndsAt = null;
            room.QuestionEndsAt = null;
            return "finished";
        }

        BeginQuestionRound(room, nowMs);
        return "question";
    }

    public static bool ResetRoomToLobby(InternalRoom room, string playerId)
    {
        var host = room.Players.FirstOrDefault(p => p.Id == playerId && p.IsHost);
        if (host is null) return false;

        room.Phase = "waiting";
        room.Questions.Clear();
        room.CurrentQuestionIndex = 0;
        room.QuestionEndsAt = null;
        room.PhaseEndsAt = null;
        room.Reveal = null;

        room.Players.RemoveAll(p => !p.Connected);
        for (var i = 0; i < room.Players.Count; i++)
        {
            var p = room.Players[i];
            p.Score = 0;
            p.Streak = 0;
            p.MaxStreak = 0;
            p.CorrectCount = 0;
            p.WrongCount = 0;
            p.TimeoutCount = 0;
            p.HasAnsweredCurrent = false;
            p.LastEarnedScore = 0;
            p.LastAnswerIndex = null;
            p.LastAnswerCorrect = null;
            p.LastAnswerElapsedMs = null;
            p.IsEliminated = false;
            p.EliminatedRound = null;
            p.Rank = i + 1;
            p.PreviousRank = i + 1;
            p.IsReady = true;
        }
        return true;
    }

    public static ClientRoomSnapshot BuildSnapshot(InternalRoom room, long nowMs)
    {
        var currentQ = (room.CurrentQuestionIndex >= 0 && room.CurrentQuestionIndex < room.Questions.Count)
            ? room.Questions[room.CurrentQuestionIndex]
            : null;
        var showQuestion = room.Phase is "question" or "reveal";

        var connectedPlayers = room.Players.Where(p => p.Connected).ToList();
        var activeCount = room.Players.Count(p => !p.IsEliminated);
        var activeConnected = connectedPlayers.Where(p => !p.IsEliminated).ToList();
        var answeredCount = activeConnected.Count(p => p.HasAnsweredCurrent);

        var sortedPlayers = room.Players.Select(p => p.Clone()).ToList();
        if (room.Phase != "waiting")
        {
            sortedPlayers.Sort(ComparePlayersForStandings);
        }

        var targetEnd = room.Phase == "question" ? room.QuestionEndsAt : room.PhaseEndsAt;
        long? remainingMs = targetEnd.HasValue ? Math.Max(0L, targetEnd.Value - nowMs) : null;

        return new ClientRoomSnapshot
        {
            Code = room.Code,
            Phase = room.Phase,
            Settings = room.Settings.Clone(),
            Players = sortedPlayers,
            CurrentQuestionIndex = room.CurrentQuestionIndex,
            TotalQuestions = room.Questions.Count,
            QuestionEndsAt = room.QuestionEndsAt,
            TotalQuestionTime = room.TotalQuestionTime,
            PhaseEndsAt = room.PhaseEndsAt,
            ServerNow = nowMs,
            RemainingMs = remainingMs,
            CurrentQuestion = showQuestion && currentQ is not null
                ? new PublicQuestionPayload
                {
                    Id = currentQ.Id,
                    Difficulty = currentQ.Difficulty,
                    CategoryLabel = currentQ.CategoryLabel,
                    BgTheme = currentQ.BgTheme,
                    BgImageKey = currentQ.BgImageKey,
                    MotifLabel = currentQ.MotifLabel,
                    Question = currentQ.Question,
                    Options = currentQ.Options
                }
                : null,
            Reveal = room.Phase == "reveal" ? room.Reveal : null,
            AnsweredCount = answeredCount,
            ActiveCount = activeCount,
            ConnectedCount = activeConnected.Count
        };
    }

    public static PublicRoomSummary BuildRoomSummary(InternalRoom room)
    {
        var host = room.Players.FirstOrDefault(p => p.IsHost) ?? room.Players.FirstOrDefault();
        return new PublicRoomSummary
        {
            Code = room.Code,
            HostName = host?.Name ?? "میزبان",
            PlayerCount = room.Players.Count(p => p.Connected),
            Phase = room.Phase,
            Difficulty = room.Settings.Difficulty,
            QuestionCount = room.Settings.QuestionCount,
            GameMode = room.Settings.GameMode
        };
    }
}
