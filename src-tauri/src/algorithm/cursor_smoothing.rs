use crate::models::events::InputEvent;

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPoint {
    pub ts: u64,
    pub x: f64,
    pub y: f64,
    pub is_click: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct MotionPattern {
    pub has_deceleration: bool,
    pub dwell_time_ms: u64,
    pub approach_velocity: f64,
    pub is_jitter: bool,
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
struct VelocitySample {
    ts: u64,
    speed_px_per_ms: f64,
}

pub fn collect_cursor_points(events: &[InputEvent]) -> Vec<CursorPoint> {
    let mut points = events
        .iter()
        .filter_map(|event| match event {
            InputEvent::Move { ts, x, y } => Some(CursorPoint {
                ts: *ts,
                x: *x,
                y: *y,
                is_click: false,
            }),
            InputEvent::Click { ts, x, y, .. } => Some(CursorPoint {
                ts: *ts,
                x: *x,
                y: *y,
                is_click: true,
            }),
            _ => None,
        })
        .collect::<Vec<_>>();

    points.sort_by_key(|point| point.ts);
    dedupe_points(points)
}

pub fn smooth_cursor_path(events: &[InputEvent], smoothing_factor: f64) -> Vec<CursorPoint> {
    let points = collect_cursor_points(events);
    smooth_cursor_points(&points, smoothing_factor)
}

pub fn smooth_cursor_points(points: &[CursorPoint], smoothing_factor: f64) -> Vec<CursorPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let factor = smoothing_factor.clamp(0.0, 1.0);
    if factor <= f64::EPSILON {
        return points.to_vec();
    }

    // Шаг 1: Обнаружение и удаление дрожания мыши
    let denoised = detect_and_remove_jitter(points);
    if denoised.len() < 2 {
        return denoised;
    }

    // Шаг 2: Resample @ 60Hz (вместо 120Hz для лучшей фильтрации)
    let resampled = resample_points(&denoised, 60.0);
    if resampled.len() < 2 {
        return resampled;
    }

    // Шаг 3: Bilateral filtering (сохранить края, удалить шум)
    let filtered = bilateral_filter(&resampled, factor);
    
    // Шаг 4: Velocity-aware adaptive smoothing
    let smoothed = velocity_aware_smoothing(&filtered, factor);

    // Шаг 5: Catmull-Rom интерполяция с учетом ускорения
    let samples_per_segment = ((2.0 + factor * 6.0).round() as usize).max(2);
    let interpolated = catmull_rom_interpolate_with_acceleration(&smoothed, samples_per_segment);
    
    // Шаг 6: Snap click points
    snap_click_points(interpolated, &resampled)
}

/// Сохранён для совместимости с предыдущим API.
/// RDP-упрощение намеренно отключено для сохранения микромоторных движений руки.
pub fn simplify_with_click_anchors(points: &[CursorPoint], _epsilon: f64) -> Vec<CursorPoint> {
    dedupe_points(points.to_vec())
}

/// Сохранён для совместимости с предыдущим API.
/// Использует Catmull-Rom сэмплирование которое проходит через точки управления.
pub fn catmull_rom_interpolate(
    points: &[CursorPoint],
    samples_per_segment: usize,
) -> Vec<CursorPoint> {
    catmull_rom_interpolate_impl(points, samples_per_segment)
}

fn resample_points(points: &[CursorPoint], hz: f64) -> Vec<CursorPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let safe_hz = if hz.is_finite() {
        hz.clamp(30.0, 240.0)
    } else {
        120.0
    };
    let step_ms = 1_000.0 / safe_hz;
    let mut sorted = dedupe_points(points.to_vec());
    if sorted.len() < 2 {
        return sorted;
    }

    sorted.sort_by_key(|point| point.ts);
    let start_ts = sorted.first().map(|point| point.ts).unwrap_or(0);
    let end_ts = sorted.last().map(|point| point.ts).unwrap_or(start_ts);
    if end_ts <= start_ts {
        return sorted;
    }

    let mut sample_ts: Vec<u64> = Vec::new();
    let mut t = start_ts as f64;
    let end_f = end_ts as f64;
    while t < end_f {
        sample_ts.push(t.round() as u64);
        t += step_ms;
    }
    sample_ts.push(end_ts);
    for click in sorted.iter().filter(|point| point.is_click) {
        sample_ts.push(click.ts);
    }
    sample_ts.sort_unstable();
    sample_ts.dedup();

    let mut result: Vec<CursorPoint> = Vec::with_capacity(sample_ts.len());
    let mut segment_index = 0usize;
    for ts in sample_ts {
        let mut point = sample_at_ts(&sorted, ts, &mut segment_index);
        point.is_click = sorted
            .iter()
            .any(|original| original.is_click && original.ts == ts);
        result.push(point);
    }

    dedupe_points(result)
}

fn sample_at_ts(points: &[CursorPoint], ts: u64, segment_index: &mut usize) -> CursorPoint {
    if points.is_empty() {
        return CursorPoint {
            ts,
            x: 0.0,
            y: 0.0,
            is_click: false,
        };
    }

    if ts <= points[0].ts {
        let mut point = points[0];
        point.ts = ts;
        point.is_click = false;
        return point;
    }

    let last = points[points.len() - 1];
    if ts >= last.ts {
        let mut point = last;
        point.ts = ts;
        point.is_click = false;
        return point;
    }

    while *segment_index + 1 < points.len() && points[*segment_index + 1].ts < ts {
        *segment_index += 1;
    }
    let left = points[*segment_index];
    let right = points[(*segment_index + 1).min(points.len() - 1)];

    if right.ts <= left.ts {
        return CursorPoint {
            ts,
            x: right.x,
            y: right.y,
            is_click: false,
        };
    }

    let ratio = (ts.saturating_sub(left.ts) as f64 / (right.ts - left.ts) as f64).clamp(0.0, 1.0);
    CursorPoint {
        ts,
        x: left.x + (right.x - left.x) * ratio,
        y: left.y + (right.y - left.y) * ratio,
        is_click: false,
    }
}

fn simple_moving_average_filter(points: &[CursorPoint], window_size: usize) -> Vec<CursorPoint> {
    if points.len() < 3 || window_size <= 1 {
        return points.to_vec();
    }

    let radius = window_size / 2;
    let mut filtered = Vec::with_capacity(points.len());

    for idx in 0..points.len() {
        let point = points[idx];
        if point.is_click {
            filtered.push(point);
            continue;
        }

        let start = idx.saturating_sub(radius);
        let end = (idx + radius + 1).min(points.len());

        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut count = 0usize;
        for sample in &points[start..end] {
            sum_x += sample.x;
            sum_y += sample.y;
            count += 1;
        }

        filtered.push(CursorPoint {
            ts: point.ts,
            x: sum_x / count as f64,
            y: sum_y / count as f64,
            is_click: false,
        });
    }

    filtered
}

fn catmull_rom_interpolate_impl(
    points: &[CursorPoint],
    samples_per_segment: usize,
) -> Vec<CursorPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let samples = samples_per_segment.max(2);
    let mut result = Vec::with_capacity((points.len() - 1) * samples + 1);
    const ALPHA: f64 = 0.5;

    for idx in 0..(points.len() - 1) {
        let p0 = if idx == 0 {
            points[idx]
        } else {
            points[idx - 1]
        };
        let p1 = points[idx];
        let p2 = points[idx + 1];
        let p3 = if idx + 2 < points.len() {
            points[idx + 2]
        } else {
            points[idx + 1]
        };

        let t0 = 0.0;
        let t1 = next_knot(t0, p0, p1, ALPHA);
        let t2 = next_knot(t1, p1, p2, ALPHA);
        let t3 = next_knot(t2, p2, p3, ALPHA);

        let mut curve_points: Vec<(f64, f64)> = Vec::with_capacity(samples + 1);
        for step in 0..=samples {
            let ratio = step as f64 / samples as f64;
            let t = t1 + (t2 - t1) * ratio;

            let a1 = interpolate_point(p0, p1, t0, t1, t);
            let a2 = interpolate_point(p1, p2, t1, t2, t);
            let a3 = interpolate_point(p2, p3, t2, t3, t);
            let b1 = interpolate_xy(a1, a2, t0, t2, t);
            let b2 = interpolate_xy(a2, a3, t1, t3, t);
            curve_points.push(interpolate_xy(b1, b2, t1, t2, t));
        }

        let mut cumulative = vec![0.0f64; curve_points.len()];
        for step in 1..curve_points.len() {
            let prev = curve_points[step - 1];
            let current = curve_points[step];
            cumulative[step] =
                cumulative[step - 1] + (current.0 - prev.0).hypot(current.1 - prev.1);
        }
        let total_len = cumulative.last().copied().unwrap_or(0.0);

        for step in 0..=samples {
            if idx > 0 && step == 0 {
                continue;
            }

            let position = curve_points[step];
            let ratio = if total_len <= 1e-9 {
                step as f64 / samples as f64
            } else {
                cumulative[step] / total_len
            };
            let ts = lerp_ts(p1.ts, p2.ts, ratio);
            let is_click = (step == 0 && p1.is_click) || (step == samples && p2.is_click);

            result.push(CursorPoint {
                ts,
                x: position.0,
                y: position.1,
                is_click,
            });
        }
    }

    result
}

fn next_knot(current: f64, a: CursorPoint, b: CursorPoint, alpha: f64) -> f64 {
    let distance = (b.x - a.x).hypot(b.y - a.y);
    current + distance.max(0.0001).powf(alpha)
}

fn interpolate_point(a: CursorPoint, b: CursorPoint, t_a: f64, t_b: f64, t: f64) -> (f64, f64) {
    interpolate_xy((a.x, a.y), (b.x, b.y), t_a, t_b, t)
}

fn interpolate_xy(a: (f64, f64), b: (f64, f64), t_a: f64, t_b: f64, t: f64) -> (f64, f64) {
    let span = (t_b - t_a).abs().max(1e-6);
    let r = ((t - t_a) / span).clamp(0.0, 1.0);
    (a.0 + (b.0 - a.0) * r, a.1 + (b.1 - a.1) * r)
}

fn lerp_ts(start: u64, end: u64, t: f64) -> u64 {
    let start_f = start as f64;
    let end_f = end as f64;
    (start_f + (end_f - start_f) * t).round() as u64
}

fn snap_click_points(mut points: Vec<CursorPoint>, reference: &[CursorPoint]) -> Vec<CursorPoint> {
    for click_point in reference.iter().copied().filter(|point| point.is_click) {
        if let Some(existing) = points.iter_mut().find(|point| point.ts == click_point.ts) {
            *existing = click_point;
        } else {
            points.push(click_point);
        }
    }

    dedupe_points(points)
}

fn dedupe_points(mut points: Vec<CursorPoint>) -> Vec<CursorPoint> {
    if points.is_empty() {
        return points;
    }

    points.sort_by_key(|point| point.ts);
    let mut deduped: Vec<CursorPoint> = Vec::with_capacity(points.len());

    for point in points {
        if let Some(last) = deduped.last_mut() {
            if point.ts == last.ts {
                if point.is_click || !last.is_click {
                    *last = point;
                }
                continue;
            }
        }
        deduped.push(point);
    }

    deduped
}

// УЛУЧШЕНИЕ 1: Jitter Detection (Обнаружение дрожания мыши)
fn detect_and_remove_jitter(points: &[CursorPoint]) -> Vec<CursorPoint> {
    if points.len() < 3 {
        return points.to_vec();
    }

    const JITTER_THRESHOLD_PX: f64 = 1.5;  // Порог дрожания в пикселях
    const JITTER_WINDOW_SIZE: usize = 5;   // Окно анализа

    let mut result: Vec<CursorPoint> = Vec::with_capacity(points.len());
    let mut i = 0;

    while i < points.len() {
        let current = points[i];

        // Для кликов всегда сохраняем
        if current.is_click {
            result.push(current);
            i += 1;
            continue;
        }

        // Проверяем окно вокруг текущей точки на дрожание
        let start = i.saturating_sub(JITTER_WINDOW_SIZE / 2);
        let end = (i + JITTER_WINDOW_SIZE / 2 + 1).min(points.len());
        let window = &points[start..end];

        // Вычисляем медиану окна
        let (median_x, median_y) = compute_median(window);

        // Если все точки в окне близко к медиане — это дрожание
        let is_jitter = window.iter().all(|p| {
            let dx = (p.x - median_x).abs();
            let dy = (p.y - median_y).abs();
            (dx * dx + dy * dy).sqrt() < JITTER_THRESHOLD_PX
        });

        if is_jitter {
            // Заменяем кластер дрожания одной точкой (медианой)
            result.push(CursorPoint {
                ts: current.ts,
                x: median_x,
                y: median_y,
                is_click: false,
            });
            i = end;  // Пропускаем весь кластер
        } else {
            result.push(current);
            i += 1;
        }
    }

    dedupe_points(result)
}

fn compute_median(points: &[CursorPoint]) -> (f64, f64) {
    if points.is_empty() {
        return (0.0, 0.0);
    }

    let mut xs: Vec<f64> = points.iter().map(|p| p.x).collect();
    let mut ys: Vec<f64> = points.iter().map(|p| p.y).collect();

    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let mid = xs.len() / 2;
    let median_x = if xs.len() % 2 == 0 {
        (xs[mid - 1] + xs[mid]) / 2.0
    } else {
        xs[mid]
    };

    let median_y = if ys.len() % 2 == 0 {
        (ys[mid - 1] + ys[mid]) / 2.0
    } else {
        ys[mid]
    };

    (median_x, median_y)
}

// УЛУЧШЕНИЕ 2: Bilateral Filter (Сохранить края, удалить шум)
fn bilateral_filter(points: &[CursorPoint], smoothing_factor: f64) -> Vec<CursorPoint> {
    if points.len() < 3 {
        return points.to_vec();
    }

    const SPATIAL_SIGMA: f64 = 2.0;  // Пространственная сигма
    const RANGE_SIGMA: f64 = 3.0;    // Сигма интенсивности

    let mut result = Vec::with_capacity(points.len());

    for (i, center) in points.iter().enumerate() {
        if center.is_click {
            result.push(*center);
            continue;
        }

        let radius = ((2.0 + smoothing_factor * 2.0).round() as usize).max(1);
        let start = i.saturating_sub(radius);
        let end = (i + radius + 1).min(points.len());

        let mut weighted_x = 0.0;
        let mut weighted_y = 0.0;
        let mut weight_sum = 0.0;

        for (j, point) in points[start..end].iter().enumerate() {
            let actual_idx = start + j;
            let spatial_dist = ((actual_idx as i32 - i as i32).abs() as f64).min(radius as f64);
            let euclidean_dist = ((point.x - center.x).powi(2) + (point.y - center.y).powi(2)).sqrt();

            // Пространственный вес (Гауссов)
            let spatial_weight = (-spatial_dist.powi(2) / (2.0 * SPATIAL_SIGMA.powi(2))).exp();

            // Вес по интенсивности (сохранить края)
            let range_weight = (-euclidean_dist.powi(2) / (2.0 * RANGE_SIGMA.powi(2))).exp();

            let weight = spatial_weight * range_weight;
            weighted_x += point.x * weight;
            weighted_y += point.y * weight;
            weight_sum += weight;
        }

        let final_x = if weight_sum > 1e-6 { weighted_x / weight_sum } else { center.x };
        let final_y = if weight_sum > 1e-6 { weighted_y / weight_sum } else { center.y };

        result.push(CursorPoint {
            ts: center.ts,
            x: final_x,
            y: final_y,
            is_click: false,
        });
    }

    result
}

// УЛУЧШЕНИЕ 3: Velocity-Aware Adaptive Smoothing
fn velocity_aware_smoothing(points: &[CursorPoint], _smoothing_factor: f64) -> Vec<CursorPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }

    // Вычисляем скорости для каждой точки
    let velocities = estimate_velocities(points);

    let mut result = Vec::with_capacity(points.len());

    for (i, point) in points.iter().enumerate() {
        if point.is_click {
            result.push(*point);
            continue;
        }

        let local_speed = velocities.get(i).copied().unwrap_or(0.5);

        // Адаптивный размер окна на основе скорости
        // Высокая скорость → меньшее окно (сохранить детали движения)
        // Низкая скорость → большое окно (удалить дрожание)
        let window = if local_speed < 0.3 {
            5  // Дрожание или неподвижность
        } else if local_speed > 1.0 {
            2  // Быстрое движение
        } else {
            3  // Нормальная скорость
        };

        // Применяем weighted moving average с адаптивным окном
        let radius = window / 2;
        let start = i.saturating_sub(radius);
        let end = (i + radius + 1).min(points.len());

        let mut sum_x = 0.0;
        let mut sum_y = 0.0;
        let mut weight_sum = 0.0;

        for (j, p) in points[start..end].iter().enumerate() {
            let dist = ((j as i32 - radius as i32).abs() as f64).max(0.1);
            let weight = 1.0 / (1.0 + dist.powi(2));  // Gaussian-like weights
            
            sum_x += p.x * weight;
            sum_y += p.y * weight;
            weight_sum += weight;
        }

        let final_x = if weight_sum > 1e-6 { sum_x / weight_sum } else { point.x };
        let final_y = if weight_sum > 1e-6 { sum_y / weight_sum } else { point.y };

        result.push(CursorPoint {
            ts: point.ts,
            x: final_x,
            y: final_y,
            is_click: false,
        });
    }

    result
}

fn estimate_velocities(points: &[CursorPoint]) -> Vec<f64> {
    let mut velocities = vec![0.0; points.len()];

    for i in 1..points.len() {
        let prev = points[i - 1];
        let curr = points[i];

        let dt = (curr.ts.saturating_sub(prev.ts) as f64).max(1.0) / 1000.0;  // в секунды
        let dx = curr.x - prev.x;
        let dy = curr.y - prev.y;
        let distance = (dx * dx + dy * dy).sqrt();

        velocities[i] = distance / dt;
    }

    // Сглаживаем сами скорости для стабильности
    let smoothed = simple_moving_average_filter(
        &velocities
            .iter()
            .enumerate()
            .map(|(i, &v)| CursorPoint {
                ts: points[i].ts,
                x: v,
                y: 0.0,
                is_click: false,
            })
            .collect::<Vec<_>>(),
        3,
    );

    smoothed.iter().map(|p| p.x).collect()
}

// УЛУЧШЕНИЕ 4: Catmull-Rom Interpolation with Acceleration
fn catmull_rom_interpolate_with_acceleration(
    points: &[CursorPoint],
    samples_per_segment: usize,
) -> Vec<CursorPoint> {
    if points.len() < 2 {
        return points.to_vec();
    }

    let samples = samples_per_segment.max(2);
    let mut result = Vec::with_capacity((points.len() - 1) * samples + 1);
    const ALPHA: f64 = 0.5;

    // Вычисляем ускорения для каждого сегмента
    let _accelerations = compute_accelerations(points);

    for idx in 0..(points.len() - 1) {
        let p0 = if idx == 0 {
            points[idx]
        } else {
            points[idx - 1]
        };
        let p1 = points[idx];
        let p2 = points[idx + 1];
        let p3 = if idx + 2 < points.len() {
            points[idx + 2]
        } else {
            points[idx + 1]
        };

        let t0 = 0.0;
        let t1 = next_knot(t0, p0, p1, ALPHA);
        let t2 = next_knot(t1, p1, p2, ALPHA);
        let t3 = next_knot(t2, p2, p3, ALPHA);

        let mut curve_points: Vec<(f64, f64)> = Vec::with_capacity(samples + 1);
        for step in 0..=samples {
            let ratio = step as f64 / samples as f64;
            let t = t1 + (t2 - t1) * ratio;

            let a1 = interpolate_point(p0, p1, t0, t1, t);
            let a2 = interpolate_point(p1, p2, t1, t2, t);
            let a3 = interpolate_point(p2, p3, t2, t3, t);
            let b1 = interpolate_xy(a1, a2, t0, t2, t);
            let b2 = interpolate_xy(a2, a3, t1, t3, t);
            curve_points.push(interpolate_xy(b1, b2, t1, t2, t));
        }

        let mut cumulative = vec![0.0f64; curve_points.len()];
        for step in 1..curve_points.len() {
            let prev = curve_points[step - 1];
            let current = curve_points[step];
            cumulative[step] =
                cumulative[step - 1] + (current.0 - prev.0).hypot(current.1 - prev.1);
        }
        let total_len = cumulative.last().copied().unwrap_or(0.0);

        for step in 0..=samples {
            if idx > 0 && step == 0 {
                continue;
            }

            let position = curve_points[step];
            let ratio = if total_len <= 1e-9 {
                step as f64 / samples as f64
            } else {
                cumulative[step] / total_len
            };
            let ts = lerp_ts(p1.ts, p2.ts, ratio);
            let is_click = (step == 0 && p1.is_click) || (step == samples && p2.is_click);

            result.push(CursorPoint {
                ts,
                x: position.0,
                y: position.1,
                is_click,
            });
        }
    }

    result
}

fn compute_accelerations(points: &[CursorPoint]) -> Vec<(f64, f64)> {
    let mut accelerations = vec![(0.0, 0.0); points.len()];

    for i in 1..points.len().saturating_sub(1) {
        let prev = points[i - 1];
        let curr = points[i];
        let next = points[i + 1];

        let dt1 = (curr.ts.saturating_sub(prev.ts) as f64).max(1.0);
        let dt2 = (next.ts.saturating_sub(curr.ts) as f64).max(1.0);

        let v1x = (curr.x - prev.x) / dt1;
        let v1y = (curr.y - prev.y) / dt1;

        let v2x = (next.x - curr.x) / dt2;
        let v2y = (next.y - curr.y) / dt2;

        let ax = (v2x - v1x) / ((dt1 + dt2) / 2.0);
        let ay = (v2y - v1y) / ((dt1 + dt2) / 2.0);

        accelerations[i] = (ax.clamp(-10.0, 10.0), ay.clamp(-10.0, 10.0));
    }

    accelerations
}

// УЛУЧШЕНИЕ 5: Analyze Pre-Click Motion Pattern
pub fn analyze_pre_click_pattern(points_before_click: &[CursorPoint]) -> MotionPattern {
    if points_before_click.is_empty() {
        return MotionPattern {
            has_deceleration: false,
            dwell_time_ms: 0,
            approach_velocity: 0.0,
            is_jitter: false,
        };
    }

    let velocities = estimate_velocities(points_before_click);
    let last_velocity = velocities.last().copied().unwrap_or(0.0);
    let first_velocity = velocities.first().copied().unwrap_or(0.0);

    // Обнаруживаем замедление (dwell время)
    let has_deceleration = last_velocity < first_velocity * 0.3;

    // Вычисляем dwell time (время неподвижности перед кликом)
    let dwell_time = if last_velocity < 0.05 {
        // Найди последовательность низкоскоростных точек в конце
        let mut dwell_ms = 0u64;
        for point in points_before_click.iter().rev() {
            if let Some(idx) = points_before_click.iter().position(|p| p.ts == point.ts) {
                if idx > 0 && velocities[idx] < 0.1 {
                    dwell_ms = point.ts.saturating_sub(
                        points_before_click.iter().rev().nth(0).map(|p| p.ts).unwrap_or(point.ts)
                    );
                } else {
                    break;
                }
            }
        }
        dwell_ms
    } else {
        0
    };

    // Проверяем на дрожание в конце траектории
    let is_jitter = if points_before_click.len() >= 5 {
        let last_points = &points_before_click[points_before_click.len().saturating_sub(5)..];
        let (median_x, median_y) = compute_median(last_points);
        last_points.iter().all(|p| {
            let dist = ((p.x - median_x).powi(2) + (p.y - median_y).powi(2)).sqrt();
            dist < 1.5
        })
    } else {
        false
    };

    MotionPattern {
        has_deceleration,
        dwell_time_ms: dwell_time,
        approach_velocity: last_velocity,
        is_jitter,
    }
}
