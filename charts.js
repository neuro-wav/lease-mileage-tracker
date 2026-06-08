// ===== Lease Mileage Tracker - Charts Module =====

window.App = window.App || {};

App.Charts = {
  _instances: {
    cumulative: null,
    gauges: [],
    period: null,
    last12weeks: null
  },

  destroyAll() {
    if (this._instances.cumulative) {
      this._instances.cumulative.destroy();
      this._instances.cumulative = null;
    }
    this.destroyAllGauges();
    if (this._instances.period) {
      this._instances.period.destroy();
      this._instances.period = null;
    }
    if (this._instances.last12weeks) {
      this._instances.last12weeks.destroy();
      this._instances.last12weeks = null;
    }
  },

  destroyAllGauges() {
    for (const g of this._instances.gauges) {
      if (g) g.destroy();
    }
    this._instances.gauges = [];
  },

  // ===== Cumulative Mileage Line Chart =====
  updateCumulativeChart(config, entries) {
    const C = App.Calc;
    const canvas = document.getElementById('chart-cumulative');
    if (!canvas) return;

    const leaseEnd = C.leaseEndDate(config.leaseStartDate, config.leaseTerm);
    const totalAllotment = C.totalAllotment(config.yearlyAllotment, config.leaseTerm);

    // Actual miles data points
    const actualData = [
      { x: new Date(config.leaseStartDate + 'T00:00:00'), y: 0 }
    ];
    for (const e of entries) {
      actualData.push({
        x: new Date(e.date + 'T00:00:00'),
        y: e.odometer - config.startingOdometer
      });
    }

    // Datasets
    const datasets = [
      {
        label: 'Actual Miles',
        data: actualData,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        fill: true,
        tension: 0.15,
        pointRadius: entries.length > 20 ? 2 : 4,
        pointHoverRadius: 6,
        borderWidth: 2.5
      },
      {
        label: `Lease Pace (${(config.yearlyAllotment / 1000).toFixed(0)}k/yr)`,
        data: [
          { x: new Date(config.leaseStartDate + 'T00:00:00'), y: 0 },
          { x: leaseEnd, y: totalAllotment }
        ],
        borderColor: '#ef4444',
        borderDash: [8, 4],
        pointRadius: 0,
        borderWidth: 2,
        fill: false
      }
    ];

    // Custom target pace lines
    const targetColors = ['#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#06b6d4'];
    config.customTargets.forEach((target, i) => {
      const targetTotal = C.totalAllotment(target.yearlyMiles, config.leaseTerm);
      datasets.push({
        label: `${target.name} (${(target.yearlyMiles / 1000).toFixed(0)}k/yr)`,
        data: [
          { x: new Date(config.leaseStartDate + 'T00:00:00'), y: 0 },
          { x: leaseEnd, y: targetTotal }
        ],
        borderColor: targetColors[i % targetColors.length],
        borderDash: [4, 4],
        pointRadius: 0,
        borderWidth: 1.5,
        fill: false
      });
    });

    const chartConfig = {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: config.leaseTerm > 24 ? 'quarter' : 'month',
              displayFormats: {
                month: 'MMM yyyy',
                quarter: 'MMM yyyy'
              }
            },
            min: config.leaseStartDate + 'T00:00:00',
            max: leaseEnd,
            title: { display: false },
            grid: { color: 'rgba(0,0,0,0.04)' }
          },
          y: {
            beginAtZero: true,
            title: { display: false },
            ticks: {
              callback: (v) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v
            },
            grid: { color: 'rgba(0,0,0,0.04)' }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString()} mi`
            }
          },
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              padding: 12,
              font: { size: 11 }
            }
          },
          zoom: {
            limits: {
              x: {
                min: new Date(config.leaseStartDate + 'T00:00:00').getTime(),
                max: leaseEnd.getTime(),
                minRange: 7 * 24 * 60 * 60 * 1000 // minimum 1 week visible
              }
            },
            pan: {
              enabled: true,
              mode: 'x'
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: 'x',
              onZoom: () => {
                const btn = document.getElementById('reset-zoom-btn');
                if (btn) btn.classList.remove('hidden');
              }
            }
          }
        }
      }
    };

    if (this._instances.cumulative) {
      this._instances.cumulative.data.datasets = datasets;
      this._instances.cumulative.options.scales.x.min = config.leaseStartDate + 'T00:00:00';
      this._instances.cumulative.options.scales.x.max = leaseEnd;
      this._instances.cumulative.options.plugins.zoom.limits.x.min = new Date(config.leaseStartDate + 'T00:00:00').getTime();
      this._instances.cumulative.options.plugins.zoom.limits.x.max = leaseEnd.getTime();
      this._instances.cumulative.update();
      this._instances.cumulative.resetZoom();
      const resetBtn = document.getElementById('reset-zoom-btn');
      if (resetBtn) resetBtn.classList.add('hidden');
    } else {
      this._instances.cumulative = new Chart(canvas, chartConfig);
    }
  },

  resetCumulativeZoom() {
    if (this._instances.cumulative) {
      this._instances.cumulative.resetZoom();
      const btn = document.getElementById('reset-zoom-btn');
      if (btn) btn.classList.add('hidden');
    }
  },

  // ===== Budget Gauge (Half Doughnut) — supports multiple instances =====
  updateGauge(index, canvasId, driven, totalAllotment, statusColor) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const colorMap = {
      green: '#22c55e',
      yellow: '#f59e0b',
      red: '#ef4444'
    };
    const fillColor = colorMap[statusColor] || '#3b82f6';
    const usedPct = Math.min(1, driven / totalAllotment);
    const remaining = Math.max(0, totalAllotment - driven);

    const data = {
      labels: ['Driven', 'Remaining'],
      datasets: [{
        data: [driven, remaining],
        backgroundColor: [fillColor, '#e5e7eb'],
        borderWidth: 0
      }]
    };

    const gaugeTextPlugin = {
      id: 'gaugeText_' + index,
      afterDraw(chart) {
        const gd = chart._gaugeData;
        if (!gd) return;
        const { ctx, width, height } = chart;
        ctx.save();
        ctx.textAlign = 'center';

        ctx.fillStyle = '#111827';
        ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
        ctx.fillText(gd.driven.toLocaleString() + ' mi', width / 2, height - 28);

        ctx.fillStyle = '#6b7280';
        ctx.font = '13px system-ui, -apple-system, sans-serif';
        ctx.fillText('of ' + gd.totalAllotment.toLocaleString() + ' mi', width / 2, height - 10);

        // Percentage
        ctx.fillStyle = gd.fillColor;
        ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
        ctx.fillText(Math.round(gd.usedPct * 100) + '%', width / 2, height - 48);

        ctx.restore();
      }
    };

    const chartConfig = {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        circumference: 180,
        rotation: 270,
        cutout: '75%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      },
      plugins: [gaugeTextPlugin]
    };

    const gaugeData = { driven, totalAllotment, fillColor, usedPct };
    const chart = new Chart(canvas, chartConfig);
    chart._gaugeData = gaugeData;
    this._instances.gauges[index] = chart;
  },

  updateAllGauges(budgets) {
    budgets.forEach((b, i) => {
      this.updateGauge(i, 'chart-gauge-' + i, b.driven, b.total, b.color);
    });
  },

  // ===== Past 12 Weeks Bar Chart =====
  updateLast12WeeksChart(config, entries) {
    const canvas = document.getElementById('chart-12weeks');
    const wrap   = document.getElementById('chart-12weeks-wrap');
    const empty  = document.getElementById('chart-12weeks-empty');
    if (!canvas) return;

    // Take the most recent 12 entries (entries are stored as weekly snapshots)
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const window12 = sorted.slice(-12);

    const showEmpty = (show) => {
      wrap.classList.toggle('hidden', show);
      empty.classList.toggle('hidden', !show);
    };

    if (window12.length === 0) {
      showEmpty(true);
      if (this._instances.last12weeks) {
        this._instances.last12weeks.destroy();
        this._instances.last12weeks = null;
      }
      return;
    }
    showEmpty(false);

    // For each entry, miles = odometer delta from the prior entry (or starting odometer)
    const budgetPerWeek = Math.round(config.yearlyAllotment / 52);

    const labels = [];
    const data   = [];
    const colors = [];

    for (let i = 0; i < window12.length; i++) {
      const e       = window12[i];
      const prevOdo = i === 0
        ? (sorted[sorted.indexOf(e) - 1]?.odometer ?? config.startingOdometer)
        : window12[i - 1].odometer;
      const miles = Math.max(0, e.odometer - prevOdo);

      const d = new Date(e.date + 'T00:00:00');
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      data.push(Math.round(miles));
      colors.push(
        miles > budgetPerWeek * 1.05 ? '#ef4444' :
        miles > budgetPerWeek        ? '#f59e0b' :
                                       '#22c55e'
      );
    }

    const budgetData = data.map(() => budgetPerWeek);

    const chartCfg = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Miles driven',
            data,
            backgroundColor: colors,
            borderRadius: 4
          },
          {
            label: 'Weekly budget',
            data: budgetData,
            type: 'line',
            borderColor: '#ef4444',
            borderDash: [6, 3],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v
            },
            grid: { color: 'rgba(0,0,0,0.04)' }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 12, font: { size: 11 } }
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (ctx.dataset.label === 'Weekly budget') {
                  return `Budget: ${Math.round(ctx.parsed.y).toLocaleString()} mi/wk`;
                }
                return `Driven: ${Math.round(ctx.parsed.y).toLocaleString()} mi`;
              }
            }
          }
        }
      }
    };

    if (this._instances.last12weeks) {
      this._instances.last12weeks.data.labels                       = labels;
      this._instances.last12weeks.data.datasets[0].data             = data;
      this._instances.last12weeks.data.datasets[0].backgroundColor  = colors;
      this._instances.last12weeks.data.datasets[1].data             = budgetData;
      this._instances.last12weeks.update();
    } else {
      this._instances.last12weeks = new Chart(canvas, chartCfg);
    }
  },

  // ===== Period Bar Chart =====
  updatePeriodChart(config, entries) {
    const C = App.Calc;
    const canvas = document.getElementById('chart-period');
    if (!canvas) return;

    const { periods, useWeekly } = C.generatePeriods(config.leaseStartDate, config.leaseTerm, entries);

    // Calculate miles for each period
    for (const p of periods) {
      p.miles = C.periodMiles(entries, config.startingOdometer, config.leaseStartDate, p.start, p.end);
    }

    // Budget per period for coloring
    const budgetPerPeriod = useWeekly
      ? config.yearlyAllotment / 52
      : config.yearlyAllotment / 12;

    const labels = periods.map(p => p.label);
    const data = periods.map(p => Math.round(p.miles));
    const colors = periods.map(p => {
      if (p.miles > budgetPerPeriod * 1.05) return '#ef4444';
      if (p.miles > budgetPerPeriod) return '#f59e0b';
      return '#22c55e';
    });

    const datasets = [{
      label: 'Miles',
      data: data,
      backgroundColor: colors,
      borderRadius: 4
    }];

    // Budget line as annotation-like dataset
    const budgetLine = {
      label: 'Budget pace',
      data: periods.map(() => Math.round(budgetPerPeriod)),
      type: 'line',
      borderColor: '#ef4444',
      borderDash: [6, 3],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false
    };

    const chartConfig = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [datasets[0], budgetLine]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 45,
              font: { size: 10 }
            }
          },
          y: {
            beginAtZero: true,
            title: { display: false },
            ticks: {
              callback: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v
            },
            grid: { color: 'rgba(0,0,0,0.04)' }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              padding: 12,
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.label === 'Budget pace') {
                  return `Budget: ${Math.round(ctx.parsed.y).toLocaleString()} mi/${useWeekly ? 'wk' : 'mo'}`;
                }
                return `${Math.round(ctx.parsed.y).toLocaleString()} mi`;
              }
            }
          }
        }
      }
    };

    if (this._instances.period) {
      this._instances.period.data.labels = labels;
      this._instances.period.data.datasets[0].data = data;
      this._instances.period.data.datasets[0].backgroundColor = colors;
      this._instances.period.data.datasets[1].data = periods.map(() => Math.round(budgetPerPeriod));
      this._instances.period.update();
    } else {
      this._instances.period = new Chart(canvas, chartConfig);
    }
  }
};
